function vims_replay_simulator(varargin)
% VIMS_REPLAY_SIMULATOR  Simulateur des 20 capteurs CAT 994F1 P1+P2
%   reproduisant EXACTEMENT le format VIMS (Paramètres Diagnostique).
%
%   Usage :
%     vims_replay_simulator                                  % defaut 600 s, CSV
%     vims_replay_simulator('duration', 1800, 'xlsx', 'export.xlsx')
%     vims_replay_simulator('fault', 'ventilo_hs', 't_fault', 60, 'duration', 1500)
%     vims_replay_simulator('post', 'http://127.0.0.1:8000/sim/ingest', 'duration', 600)
%
%   Parametres optionnels (key/value) :
%     'duration'   : duree (s)              defaut 600
%     'dt'         : pas (s)                defaut 1
%     'fault'      : ''/'ventilo_hs'/'surchauffe_progressive'/'fuite_huile'/
%                    'niveau_bas'           defaut ''
%     't_fault'    : instant defaut (s)     defaut 60
%     'csv'        : path CSV               defaut auto-named
%     'xlsx'       : path Excel format VIMS  defaut ''
%     'post'       : URL backend            defaut '' (off)
%     'speed'      : multiplicateur (post)  defaut 1
%     'engin'      : nom engin              defaut '994 F1'
%
%   PFE MineAssist - OCP Benguerir - mai 2026
% -----------------------------------------------------------------------

% --- 1) Parse args ------------------------------------------------------
p = inputParser;
addParameter(p, 'duration', 600,    @isnumeric);
addParameter(p, 'dt',       1,      @isnumeric);
addParameter(p, 'fault',    '',     @ischar);
addParameter(p, 't_fault',  60,     @isnumeric);
addParameter(p, 'csv',      '',     @ischar);
addParameter(p, 'xlsx',     '',     @ischar);
addParameter(p, 'post',     '',     @ischar);
addParameter(p, 'speed',    1,      @isnumeric);
addParameter(p, 'engin',    '994 F1', @ischar);
parse(p, varargin{:});
o = p.Results;

if isempty(o.csv) && isempty(o.xlsx) && isempty(o.post)
    o.csv = sprintf('vims_replay_%s.csv', datestr(now, 'yyyymmdd_HHMMSS'));
end

% --- 2) Charger config capteurs -----------------------------------------
this_dir = fileparts(mfilename('fullpath'));
sensors_file = fullfile(this_dir, 'vims_sensors.json');
if ~exist(sensors_file, 'file')
    error('Fichier vims_sensors.json introuvable : %s', sensors_file);
end
sensors = jsondecode(fileread(sensors_file));

% --- 3) Initialisation etat ---------------------------------------------
S = init_state();
rng(42);

% Vecteur temps
t_vec = (0:o.dt:o.duration).';
N     = numel(t_vec);

% Allocation des resultats : table N x 20
nom_capteurs = {sensors.capteurs.nom};
nC           = numel(nom_capteurs);
data         = zeros(N, nC);
timestamps   = NaT(N, 1);
t0           = datetime('now', 'Format','yyyy-MM-dd HH:mm:ss');

fprintf('\n[VIMS replay] duree=%g s  dt=%g s  defaut=%s\n', ...
    o.duration, o.dt, ternary(isempty(o.fault), 'aucun', o.fault));

% --- 4) Boucle principale -----------------------------------------------
for i = 1:N
    t = t_vec(i);
    timestamps(i) = t0 + seconds(round(t));

    % Cycle moteur
    cyc = cycle_chargeur(t);
    rpm_norm  = cyc.rpm_norm;
    load_norm = cyc.load_norm;
    hyd_norm  = cyc.hyd_norm;

    % Defauts
    ventilo_eff = 1.0;
    load_extra  = 0.0;
    if ~isempty(o.fault) && t >= o.t_fault
        switch o.fault
            case 'ventilo_hs'
                ventilo_eff = max(0, 1 - (t - o.t_fault) / 600);
            case 'surchauffe_progressive'
                load_extra = min(0.4, (t - o.t_fault) / 300 * 0.4);
            case 'niveau_bas'
                if (t - o.t_fault) > 30
                    S.niveau_huile_low = max(1, round(127 - (t - o.t_fault - 30) * 2));
                end
            case 'fuite_huile'
                S.P_huile_target_override = max(50, 450 - (t - o.t_fault) / 5);
        end
    end

    % Etat thermique
    S = step_thermique(S, o.dt, load_norm + load_extra, ventilo_eff);

    % Regime moteur
    rpm = 750 + 1010 * rpm_norm + randn() * 8;
    rpm = max(670, min(1780, rpm));

    % Pression huile moteur
    if isfield(S, 'P_huile_target_override') && ~isempty(S.P_huile_target_override)
        P_huile_target = S.P_huile_target_override;
    else
        P_huile_target = 250 + 360 * rpm_norm;
    end
    S.P_huile = S.P_huile + (P_huile_target - S.P_huile) * 0.20 + randn() * 4;
    S.P_huile = max(30, min(620, S.P_huile));

    % Pression hydraulique (calibree sur reel : vmoy 7378 kPa)
    P_hyd = 30 + 26000 * hyd_norm + randn() * 250;
    P_hyd = max(0, min(30000, P_hyd));
    if P_hyd > 28000
        P_hyd = 28000 + randn() * 80;
    end

    % Compresseur d'air (hysteresis dans plage OCP 600..900 kPa)
    % Seuils OCP 4 & 5 : alerte si P_air < 600 ou hors [600..900]
    if ~S.air_charging && S.P_air <= 700
        S.air_charging = true;
    elseif S.air_charging && S.P_air >= 870
        S.air_charging = false;
    end
    if S.air_charging
        S.P_air = S.P_air + 4 * o.dt;
    else
        S.P_air = S.P_air - 0.6 * o.dt;
    end
    S.P_air = max(620, min(890, S.P_air));

    % Pression / courant impeller
    % Seuil OCP 14 : a rpm_norm >= 0.84 (creusage/pleine charge), P_imp regule serre [1861..1869]
    if rpm_norm >= 0.84
        S.P_imp = 1865 + randn() * 1.0;
        S.P_imp = max(1861, min(1869, S.P_imp));
    else
        P_imp_target = 100 + 2200 * rpm_norm;
        S.P_imp = S.P_imp + (P_imp_target - S.P_imp) * 0.1 + randn() * 30;
    end
    S.P_imp = max(30, min(2280, S.P_imp));
    I_imp_target = 35 + 200 * rpm_norm;
    S.I_imp = S.I_imp + (I_imp_target - S.I_imp) * 0.3 + randn() * 2;
    S.I_imp = max(30, min(245, S.I_imp));
    I_lock_target = 55 + 180 * load_norm;
    S.I_lock = S.I_lock + (I_lock_target - S.I_lock) * 0.25 + randn() * 2;
    S.I_lock = max(50, min(245, S.I_lock));

    % Regime sortie convertisseur
    rpm_out = 30 + 2100 * rpm_norm + randn() * 12;
    rpm_out = max(20, min(2150, rpm_out));

    % Tension systeme
    V_target = 27200 - 200 * load_norm;
    S.V_sys = S.V_sys + (V_target - S.V_sys) * 0.10 + randn() * 25;
    S.V_sys = max(24500, min(27900, S.V_sys));

    % Debit
    if strcmp(o.fault, 'ventilo_hs') && ventilo_eff < 0.05
        debit_eau = 0;
    else
        debit_eau = 1;
    end

    % Stockage par nom de capteur (ordre = sensors.capteurs)
    sample = struct( ...
        'CH994_P1_Regime_moteur',                  rpm, ...
        'CH994_P1_Pression_huile_moteur',          S.P_huile, ...
        'CH994_P1_Temperature_liquide_refroidissement', S.T_eau, ...
        'CH994_P1_Temperature_sortie_convertisseur',    S.T_conv, ...
        'CH994_P1_Temperature_echappement_Droit',  S.T_echap_d, ...
        'CH994_P1_Temperature_echappement_gauche', S.T_echap_g, ...
        'CH994_P1_Temperature_huile_direction',    S.T_huile_dir, ...
        'CH994_P1_Temperature_huile_freinage',     S.T_huile_frein, ...
        'CH994_P1_Temperature_PTO_avant',          S.T_PTO, ...
        'CH994_P1_Debit_liquide_refroidissement',  debit_eau, ...
        'CH994_P1_Niveau_huile_moteur_bas',        S.niveau_huile_low, ...
        'CH994_P2_Pression_pompe_hydraulique_principale', P_hyd, ...
        'CH994_P2_Pression_air_reservoir',         S.P_air, ...
        'CH994_P2_Pression_embrayage_impeller',    S.P_imp, ...
        'CH994_P2_Courant_embrayage_impeller',     S.I_imp, ...
        'CH994_P2_Courant_embrayage_Lockup',       S.I_lock, ...
        'CH994_P2_Regime_sortie_convertisseur',    rpm_out, ...
        'CH994_P2_Temperature_Essieux_avant',      S.T_essieu_av, ...
        'CH994_P2_Temperature_essieux_arriere',    S.T_essieu_ar, ...
        'CH994_P2_Tension_electrique_de_systeme',  S.V_sys ...
    );
    field_order = fieldnames(sample);
    for c = 1:nC
        data(i, c) = sample.(field_order{c});
    end

    % Heartbeat
    if mod(i-1, 60) == 0
        fprintf('  t=%5.0f s  RPM=%4.0f  T_eau=%5.1f degC  P_hyd=%5.1f bar  fan=%s\n', ...
            t, rpm, S.T_eau, P_hyd/100, ternary(S.fan_state, 'ON ', 'OFF'));
    end

    % POST temps reel
    if ~isempty(o.post)
        post_realtime(o.post, o.engin, timestamps(i), P_hyd/100, S.T_eau, ...
                      sample, field_order);
        % cadence temps reel
        target_t = i / o.speed;
        elapsed  = seconds(datetime('now') - t0);
        if elapsed < target_t
            pause(target_t - elapsed);
        end
    end
end

% --- 5) Export CSV -------------------------------------------------------
if ~isempty(o.csv)
    export_csv(o.csv, timestamps, data, nom_capteurs);
end

% --- 6) Export Excel format VIMS ----------------------------------------
if ~isempty(o.xlsx)
    export_xlsx_vims(o.xlsx, timestamps, data, sensors, o.engin);
end

fprintf('\n[ok] Simulation terminee.\n');
end


% =======================================================================
% INIT STATE
% =======================================================================
function S = init_state()
S.T_eau         = 75.0;
S.T_met         = 70.0;
S.T_huile_dir   = 22.0;
S.T_huile_frein = 25.0;
S.T_PTO         = 22.0;
S.T_essieu_av   = 22.0;
S.T_essieu_ar   = 22.0;
S.T_conv        = 30.0;
S.T_echap_d     = 30.0;
S.T_echap_g     = 30.0;
S.fan_state     = false;
S.P_huile       = 450.0;
S.P_air         = 750.0;  % milieu de la plage OCP 600..900
S.air_charging  = false;
S.P_imp         = 1200.0;
S.I_imp         = 60.0;
S.I_lock        = 60.0;
S.V_sys         = 27000.0;
S.niveau_huile_low = 127;
S.P_huile_target_override = [];
end


% =======================================================================
% CYCLE CHARGEUR
% =======================================================================
function c = cycle_chargeur(t)
phase = mod(t, 60.0) / 60.0;
if phase < 10/60
    c.rpm_norm  = 0.10;  c.load_norm = 0.05;  c.hyd_norm = 0.02;
elseif phase < 15/60
    x = (phase - 10/60) / (5/60);
    c.rpm_norm  = 0.10 + x * 0.55;
    c.load_norm = 0.05 + x * 0.35;
    c.hyd_norm  = 0.02 + x * 0.55;
elseif phase < 30/60
    % creusage : pic court
    c.rpm_norm  = 0.85;  c.load_norm = 0.90;  c.hyd_norm = 0.65;  % seuil OCP 6 : >= 15000 kPa
elseif phase < 40/60
    c.rpm_norm  = 0.95;  c.load_norm = 0.95;  c.hyd_norm = 0.62;  % seuil OCP 6 : >= 15000 kPa
elseif phase < 50/60
    c.rpm_norm  = 0.55;  c.load_norm = 0.40;  c.hyd_norm = 0.10;
else
    c.rpm_norm  = 0.15;  c.load_norm = 0.15;  c.hyd_norm = 0.04;
end
end


% =======================================================================
% STEP THERMIQUE (2 noeuds + autres)
% =======================================================================
function S = step_thermique(S, dt, load_norm, ventilo_eff)
T_amb = 30.0;  k_em = 1200; C_eau = 50e3; C_met = 25e3;
k_off = 200;   k_on = 1800;

% Hysteresis ventilo
if ~S.fan_state && S.T_eau >= 85
    S.fan_state = true;
elseif S.fan_state && S.T_eau <= 82
    S.fan_state = false;
end

if S.fan_state
    k_air = k_off + (k_on - k_off) * ventilo_eff;
else
    k_air = k_off;
end

P_diss = 8000 + 22000 * load_norm;
q_em   = k_em  * (S.T_eau - S.T_met);
q_air  = k_air * (S.T_met - T_amb);
S.T_eau = S.T_eau + dt * (P_diss - q_em) / C_eau;
S.T_met = S.T_met + dt * (q_em - q_air)   / C_met;

% Autres temperatures
S.T_PTO         = relax(S.T_PTO,         22 + 65 * load_norm, dt, 60);
S.T_huile_dir   = relax(S.T_huile_dir,   22 + 50 * load_norm, dt, 90);
S.T_huile_frein = relax(S.T_huile_frein, 25 + 60 * load_norm, dt, 75);
S.T_essieu_av   = relax(S.T_essieu_av,   22 + 40 * load_norm, dt, 120);
S.T_essieu_ar   = relax(S.T_essieu_ar,   22 + 45 * load_norm, dt, 120);
S.T_conv        = relax(S.T_conv,        50 + 65 * load_norm, dt, 45);
T_ech = 30 + 540 * (max(0, load_norm))^0.7;
S.T_echap_d     = relax(S.T_echap_d, T_ech,     dt, 12);
S.T_echap_g     = relax(S.T_echap_g, T_ech - 8, dt, 12);
end


function y = relax(y0, y_target, dt, tau)
y = y0 + dt * (y_target - y0) / tau;
end


% =======================================================================
% EXPORT CSV
% =======================================================================
function export_csv(path, timestamps, data, nom_capteurs)
fid = fopen(path, 'w', 'n', 'UTF-8');
fprintf(fid, 'Heure');
for c = 1:numel(nom_capteurs)
    fprintf(fid, ';%s', nom_capteurs{c});
end
fprintf(fid, '\n');
for i = 1:numel(timestamps)
    fprintf(fid, '%s', datestr(timestamps(i), 'yyyy-mm-dd HH:MM:SS'));
    for c = 1:size(data, 2)
        fprintf(fid, ';%g', data(i, c));
    end
    fprintf(fid, '\n');
end
fclose(fid);
fprintf('[ok] CSV ecrit -> %s (%d lignes)\n', path, numel(timestamps));
end


% =======================================================================
% EXPORT EXCEL FORMAT VIMS
% =======================================================================
function export_xlsx_vims(path, timestamps, data, sensors, engin)
window_s = 120;
N        = numel(timestamps);
nwin     = max(1, floor(N / window_s));
nC       = numel(sensors.capteurs);

% Header
T_header = cell(8, 9);
T_header{1, 1} = 'Rapport de diagnostic parametres';
T_header{3, 1} = 'Enterprise';      T_header{3, 2} = 'Benguerir';
T_header{4, 1} = 'Engin';           T_header{4, 2} = engin;
T_header{5, 1} = 'Intervalle';
T_header{5, 2} = sprintf('%s - %s', ...
    datestr(timestamps(1),   'dd.mm.yyyy HH:MM:SS'), ...
    datestr(timestamps(end), 'dd.mm.yyyy HH:MM:SS'));
T_header{6, 1} = 'Parametres Diagnostic';
T_header{6, 2} = sprintf('%d objet', nC);

% Header row 9
H = {'Engin', 'Parametres Diagnostic', 'Code', 'Heure', ...
     'Valeur minimale', 'Valeur moyenne', 'Valeur maximale', ...
     'Unite de mesure', 'Fonctionnement du capteur'};

% Data rows
total_rows = nwin * nC;
M = cell(total_rows, 9);
row = 1;
for j = 1:nwin
    i0 = (j - 1) * window_s + 1;
    i1 = min(N, j * window_s);
    ts_snap = timestamps(i1);
    for c = 1:nC
        cap = sensors.capteurs(c);
        vals = data(i0:i1, c);
        M{row, 1} = engin;
        M{row, 2} = cap.nom;
        M{row, 3} = cap.code;
        M{row, 4} = datestr(ts_snap, 'dd.mm.yyyy HH:MM:SS');
        M{row, 5} = round(min(vals));
        M{row, 6} = round(mean(vals));
        M{row, 7} = round(max(vals));
        M{row, 8} = cap.unite;
        M{row, 9} = 'Oui';
        row = row + 1;
    end
end

writecell(T_header, path, 'Sheet', 1, 'Range', 'A1');
writecell(H,        path, 'Sheet', 1, 'Range', 'A9');
writecell(M,        path, 'Sheet', 1, 'Range', 'A10');

fprintf('[ok] Excel VIMS ecrit -> %s (%d snapshots x %d capteurs)\n', ...
    path, nwin, nC);
end


% =======================================================================
% POST TEMPS REEL
% =======================================================================
function post_realtime(url, engin, ts, P_pompe_bar, T_eau_C, sample, field_order)
extra = struct();
for f = 1:numel(field_order)
    fn = field_order{f};
    extra.(fn) = sample.(fn);
end
body = struct( ...
    'engin', engin, ...
    'ts',    char(ts), ...
    'P_pompe_bar', P_pompe_bar, ...
    'T_eau_C',     T_eau_C, ...
    'extra',       extra ...
);
try
    options = weboptions('MediaType', 'application/json', 'Timeout', 2);
    webwrite(url, body, options);
catch ex
    fprintf('  WARN post failed : %s\n', ex.message);
end
end


% =======================================================================
% UTIL : ternary
% =======================================================================
function y = ternary(cond, a, b)
if cond, y = a; else, y = b; end
end
