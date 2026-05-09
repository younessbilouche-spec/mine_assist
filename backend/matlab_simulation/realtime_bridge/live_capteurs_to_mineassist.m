%% LIVE_CAPTEURS_TO_MINEASSIST  Bridge temps reel MATLAB -> MineAssist
%
% Avance les modeles hydraulique + thermique a 1 Hz et POST chaque
% snapshot capteurs au backend MineAssist (FastAPI), endpoint /sim/ingest.
%
% Pre-requis :
%   - Backend MineAssist demarre (par defaut http://127.0.0.1:8000)
%   - sim_router.py monte dans api.py
%   - parametres_hydraulique.m + parametres_thermique.m sur le path
%
% Usage typique :
%   live_capteurs_to_mineassist                                    % 30 min normal
%   live_capteurs_to_mineassist('fault','fuite_hydraulique','t_fault',60)
%   live_capteurs_to_mineassist('fault','ventilo_hs','duration',900)

function live_capteurs_to_mineassist(varargin)
    % --- Arguments nommes (key/value) ---
    args = parse_args(varargin{:});

    % --- Parametres physiques (etape 1 + 2) ---
    p_h = parametres_hydraulique();
    p_t = parametres_thermique();

    % --- Etat ---
    s.p_pompe   = 0.5e6;        % Pa
    s.x_verin   = 0.0;
    s.v_verin   = 0.0;
    s.T_block   = p_t.T_block_0;
    s.T_coolant = p_t.T_coolant_0;
    s.fan_on    = p_t.fan_0;

    % --- HTTP options ---
    api_url = sprintf('%s/sim/ingest', args.api);
    opts = weboptions('MediaType', 'application/json', ...
                      'Timeout', 2.0, ...
                      'RequestMethod', 'post');

    fprintf('=== MATLAB live bridge -> MineAssist ===\n');
    fprintf('  API     : %s\n', api_url);
    fprintf('  Engin   : %s\n', args.engin);
    fprintf('  Duree   : %d s    (dt=%.1f s, vitesse x%.1f)\n', ...
            args.duration, args.dt, args.speed);
    if ~isempty(args.fault)
        fprintf('  Defaut  : %s a t=%.0f s\n', args.fault, args.t_fault);
    end
    fprintf('\n');

    rng(42);
    t = 0;
    n_alertes_total = 0;
    t_real_start = tic;

    sub_dt = 0.01;     % sous-pas pour l'hydraulique (100 Hz)
    n_sub  = round(args.dt / sub_dt);

    while t < args.duration
        % ---- Hydraulique : sous-pas ----
        for k = 1:n_sub
            u = max(-1, min(1, cmd_hydraulique(t)));
            Q_pompe = p_h.eta_pompe * p_h.Q_nom * u;

            Q_fuite = 0;
            if strcmp(args.fault, 'fuite_hydraulique') && t >= args.t_fault
                Q_fuite = 80e-3 / 60;     % 80 L/min
            end

            Q_consomme = p_h.A_piston * s.v_verin;
            dp = (Q_pompe - Q_fuite - Q_consomme ...
                  - (s.p_pompe - p_h.p_min)/p_h.R_canal) / p_h.C_hydr;
            F_pression = s.p_pompe * p_h.A_piston;
            F_poids    = p_h.M_charge * p_h.g;
            F_frot     = p_h.b_frot * s.v_verin;
            F_butee = 0;
            if s.x_verin > 0.6
                F_butee = F_butee - 1e7*(s.x_verin - 0.6) - 5e5*max(0, s.v_verin);
            end
            if s.x_verin < 0
                F_butee = F_butee - 1e7*s.x_verin - 5e5*min(0, s.v_verin);
            end
            dv = (F_pression - F_poids - F_frot + F_butee) / p_h.M_charge;

            s.p_pompe = max(p_h.p_min, min(p_h.p_max, s.p_pompe + sub_dt*dp));
            s.x_verin = s.x_verin + sub_dt*s.v_verin;
            s.v_verin = s.v_verin + sub_dt*dv;
        end

        % ---- Thermique : 1 pas ----
        rpm = regime_moteur(t);
        rpm = max(p_t.RPM_idle, min(p_t.RPM_max, rpm));
        P_moteur = p_t.P_max * (rpm / p_t.RPM_max).^2.5;

        if s.T_coolant >= p_t.T_fan_on
            s.fan_on = true;
        elseif s.T_coolant <= p_t.T_fan_off
            s.fan_on = false;
        end
        if strcmp(args.fault, 'ventilo_hs') && t >= args.t_fault
            s.fan_on = false;
        end

        Q_comb = (1 - p_t.eta_thermo) * p_t.frac_coolant * P_moteur;
        Q_bc   = p_t.U_bc * (s.T_block - s.T_coolant);
        if s.fan_on, U_rad = p_t.U_rad_on; else, U_rad = p_t.U_rad_off; end
        if strcmp(args.fault, 'radiateur_encrasse') && t >= args.t_fault
            U_rad = U_rad * 0.15;
        end

        C_eff = p_t.C_coolant;
        if strcmp(args.fault, 'niveau_bas') && t >= args.t_fault
            C_eff = p_t.C_coolant * 0.30;
            U_rad = U_rad * 0.15;
        end

        Q_rad = U_rad * (s.T_coolant - p_t.T_amb);

        s.T_block   = s.T_block   + args.dt * (Q_comb - Q_bc) / p_t.C_block;
        s.T_coolant = s.T_coolant + args.dt * (Q_bc - Q_rad)  / C_eff;

        % ---- Capteurs derives ----
        rpm_n  = rpm + 5*randn();
        norm_rpm = (rpm - p_t.RPM_idle) / (p_t.RPM_max - p_t.RPM_idle);
        p_hyd_bar = s.p_pompe / 1e5;

        derived = struct();
        derived.p_huile_moteur = 200 + 0.18*rpm + 8*randn();
        derived.T_ech_d        = 250 + 230*norm_rpm + 8*randn();
        derived.T_ech_g        = 245 + 230*norm_rpm + 8*randn();
        derived.T_sortie_conv  = 60 + 20*norm_rpm + 1.0*randn();
        derived.T_huile_dir    = 45 + 0.05*p_hyd_bar + 0.7*randn();
        derived.T_huile_frein  = 60 + 0.04*p_hyd_bar + 0.7*randn();
        derived.T_huile_hyd    = 50 + 0.10*p_hyd_bar + 0.8*randn();
        derived.T_PTO_avant    = 50 + 12*norm_rpm + 1.2*randn();
        derived.T_essieu_av    = 42 + 8*norm_rpm + 1.0*randn();
        derived.T_essieu_ar    = 42 + 8*norm_rpm + 1.0*randn();
        derived.p_air          = 750 + 50*sin(2*pi*t/90) + 8*randn();
        derived.p_sortie_conv  = 400 + 100*norm_rpm + 10*randn();

        % ---- Construire payload ----
        payload = build_payload(s, t, derived, args, rpm_n);

        % ---- POST ----
        try
            resp = webwrite(api_url, payload, opts);
            if resp.nb_alertes > 0
                n_alertes_total = n_alertes_total + resp.nb_alertes;
                for k = 1:numel(resp.alertes)
                    a = resp.alertes(k);
                    fprintf('  [t=%6.1fs] %-9s %-30s = %.1f %s (seuil %g)\n', ...
                            t, a.niveau, a.label, a.valeur, a.unite, a.seuil);
                end
            end
        catch ME
            if t < 5
                warning('POST failed : %s', ME.message);
            end
        end

        % ---- Affichage local toutes les 10 s ----
        if mod(round(t), 10) == 0 && abs(t - round(t)) < args.dt/2
            tag = '';
            if ~isempty(args.fault) && t >= args.t_fault
                tag = sprintf(' [DEFAUT=%s]', args.fault);
            end
            fprintf('  t=%6.1fs | P=%5.1f bar | T_eau=%5.1f degC | fan=%s | rpm=%5.0f | %s | alertes=%d%s\n', ...
                    t, s.p_pompe/1e5, s.T_coolant, ...
                    ternary(s.fan_on, 'ON ', 'off'), rpm_n, ...
                    cycle_phase(t), n_alertes_total, tag);
        end

        % ---- Cadence temps reel ----
        if args.speed > 0
            target = (t + args.dt) / args.speed;
            elapsed = toc(t_real_start);
            sleep_s = target - elapsed;
            if sleep_s > 0
                pause(sleep_s);
            end
        end

        t = t + args.dt;
    end

    fprintf('\nSimulation terminee. %d alertes envoyees.\n', n_alertes_total);
end


% ===================================================================
function args = parse_args(varargin)
    args.api      = 'http://127.0.0.1:8000';
    args.engin    = '994F1';
    args.duration = 1800;
    args.dt       = 1.0;
    args.speed    = 1.0;
    args.fault    = '';
    args.t_fault  = 60;

    for i = 1:2:numel(varargin)
        args.(varargin{i}) = varargin{i+1};
    end
end

function u = cmd_hydraulique(t)
    tau = mod(t, 60);
    if     tau < 10, u = 0.2;
    elseif tau < 25, u = 1.0;
    elseif tau < 40, u = 0.0;
    elseif tau < 55, u = -1.0;
    else,            u = 0.0;
    end
end

function s = cycle_phase(t)
    tau = mod(t, 60);
    if     tau < 10, s = 'approche';
    elseif tau < 25, s = 'levage  ';
    elseif tau < 40, s = 'maintien';
    elseif tau < 55, s = 'vidage  ';
    else,            s = 'retour  ';
    end
end

function r = regime_moteur(t)
    tau = mod(t, 60);
    if     tau < 15, r = 750;
    elseif tau < 40, r = 1500;
    elseif tau < 50, r = 1700;
    else,            r = 750;
    end
end

function v = ternary(cond, a, b)
    if cond, v = a; else, v = b; end
end

function p = build_payload(s, t, d, args, rpm)
    p_pompe_kPa = s.p_pompe / 1000;

    mesures = {};
    % IMPORTANT : noms canoniques avec accents (= capteur_thresholds.py)
    mesures{end+1} = struct('parametre','CH994.P1.Pression pompe hydraulique principale', ...
                            'valeur', p_pompe_kPa + 200*randn(), 'unite','kPa');
    mesures{end+1} = struct('parametre','CH994.P1.Pression huile moteur', ...
                            'valeur', d.p_huile_moteur, 'unite','kPa');
    mesures{end+1} = struct('parametre',char(['CH994.P2.Pression d' char(8217) 'air au r' char(233) 'servoir']), ...
                            'valeur', d.p_air, 'unite','kPa');
    mesures{end+1} = struct('parametre','CH994.P1.Pression sortie convertisseur', ...
                            'valeur', d.p_sortie_conv, 'unite','kPa');
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature liquide refroidissement']), ...
                            'valeur', s.T_coolant + 0.5*randn(), 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature huile direction']), ...
                            'valeur', d.T_huile_dir, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature huile freinage']), ...
                            'valeur', d.T_huile_frein, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature huile hydraulique']), ...
                            'valeur', d.T_huile_hyd, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature PTO avant']), ...
                            'valeur', d.T_PTO_avant, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature ' char(233) 'chappement Droit']), ...
                            'valeur', d.T_ech_d, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature ' char(233) 'chappement gauche']), ...
                            'valeur', d.T_ech_g, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P1.Temp' char(233) 'rature sortie convertisseur']), ...
                            'valeur', d.T_sortie_conv, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P2.Temp' char(233) 'rature essieux avant']), ...
                            'valeur', d.T_essieu_av, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P2.Temp' char(233) 'rature essieux arri' char(232) 're']), ...
                            'valeur', d.T_essieu_ar, 'unite',char([char(176) 'C']));
    mesures{end+1} = struct('parametre',char(['CH994.P2.R' char(233) 'gime moteur']), ...
                            'valeur', rpm, 'unite','Tr/min');

    p = struct();
    p.engin       = args.engin;
    p.horodatage  = char(datetime('now', 'Format', 'yyyy-MM-dd''T''HH:mm:ss'));
    p.cycle_phase = strtrim(cycle_phase(t));
    if ~isempty(args.fault) && t >= args.t_fault
        p.defaut_actif = args.fault;
    else
        p.defaut_actif = '';
    end
    p.mesures = mesures;
end
