function run_vims_demo()
% RUN_VIMS_DEMO  Demo one-shot : 3 simulations differentes + export.
%
%   1) Simulation normale (10 min)        -> sortie_normale.xlsx
%   2) Defaut ventilo HS (25 min)          -> sortie_ventilo_hs.xlsx
%   3) Defaut fuite huile (15 min)         -> sortie_fuite_huile.xlsx
%
%   Apres execution, tu peux ouvrir les 3 .xlsx dans Excel et les
%   comparer avec ton fichier VIMS reel : meme structure, memes colonnes.
%
%   Usage simple :
%     >> run_vims_demo
%
% PFE MineAssist - OCP Benguerir - mai 2026
% -----------------------------------------------------------------------

fprintf('\n==========================================\n');
fprintf('  VIMS Replay Simulator - DEMO 3 scenarios\n');
fprintf('==========================================\n\n');

% --- 1) Simulation normale (10 min) -------------------------------------
fprintf('[1/3] Simulation normale (10 min)\n');
vims_replay_simulator( ...
    'duration', 600, ...
    'csv',  'sortie_normale.csv', ...
    'xlsx', 'sortie_normale.xlsx');

% --- 2) Defaut ventilo HS (25 min) --------------------------------------
fprintf('\n[2/3] Defaut ventilo HS (25 min, defaut a t=60s)\n');
vims_replay_simulator( ...
    'duration', 1500, ...
    'fault',   'ventilo_hs', ...
    't_fault', 60, ...
    'csv',  'sortie_ventilo_hs.csv', ...
    'xlsx', 'sortie_ventilo_hs.xlsx');

% --- 3) Defaut fuite huile (15 min) -------------------------------------
fprintf('\n[3/3] Defaut fuite huile (15 min, defaut a t=120s)\n');
vims_replay_simulator( ...
    'duration', 900, ...
    'fault',   'fuite_huile', ...
    't_fault', 120, ...
    'csv',  'sortie_fuite_huile.csv', ...
    'xlsx', 'sortie_fuite_huile.xlsx');

fprintf('\n==========================================\n');
fprintf('  6 fichiers generes :\n');
fprintf('    sortie_normale.csv     (10 min)\n');
fprintf('    sortie_normale.xlsx    (10 min, format VIMS)\n');
fprintf('    sortie_ventilo_hs.csv  (25 min, defaut)\n');
fprintf('    sortie_ventilo_hs.xlsx (25 min, defaut, format VIMS)\n');
fprintf('    sortie_fuite_huile.csv (15 min, defaut)\n');
fprintf('    sortie_fuite_huile.xlsx (15 min, defaut, format VIMS)\n');
fprintf('\n  Ouvre n''importe lequel des .xlsx dans Excel et\n');
fprintf('  compare-le avec ton fichier VIMS reel : meme format !\n');
fprintf('==========================================\n\n');

end
