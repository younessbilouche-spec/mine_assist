import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "0";
  }
  return new Intl.NumberFormat("fr-FR").format(Number(value));
}

function parseSymptoms(text) {
  return text
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function StatusBadge({ online, label }) {
  return (
    <div className={`status-badge ${online ? "online" : "offline"}`}>
      <span className="status-dot" />
      {label}
    </div>
  );
}

function MetricCard({ label, value, sub, tone = "green" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}

function Panel({ title, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-title">{title}</div>
      {children}
    </section>
  );
}

function SourceChips({ sources }) {
  if (!sources || sources.length === 0) {
    return <div className="muted-note">Aucune source documentaire trouvée.</div>;
  }

  return (
    <div className="chips">
      {sources.map((src, index) => (
        <span key={`${src}-${index}`} className="chip">
          {src}
        </span>
      ))}
    </div>
  );
}

function ResultImages({ images }) {
  if (!images || images.length === 0) return null;

  return (
    <div className="images-grid">
      {images.slice(0, 3).map((img, idx) => (
        <div className="image-card" key={idx}>
          <img
            src={`data:image/png;base64,${img.image_b64}`}
            alt={`${img.pdf || "document"} page ${img.page || ""}`}
          />
          <div className="image-caption">
            {img.pdf || "Document"} · page {img.page || "-"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");

  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");

  const [question, setQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState("");
  const [askResult, setAskResult] = useState(null);

  const [faultCode, setFaultCode] = useState("");
  const [symptomsText, setSymptomsText] = useState("");
  const [gmaoContext, setGmaoContext] = useState("");
  const [hoursSinceMaintenance, setHoursSinceMaintenance] = useState("");
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState("");
  const [diagResult, setDiagResult] = useState(null);

  const [notifResult, setNotifResult] = useState(null);
  const [notifLoading, setNotifLoading] = useState(false);

  useEffect(() => {
    loadHealth();
    loadStats();
  }, []);

  async function loadHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      setHealth({ _error: err.message || "API inaccessible" });
    }
  }

  async function loadStats() {
    try {
      setStatsError("");
      const res = await fetch(`${API_BASE}/gmao/stats`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Erreur ${res.status}`);
      }
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setStatsError(err.message || "Erreur chargement GMAO");
      setStats(null);
    }
  }

  async function handleAsk() {
    if (!question.trim()) {
      setAskError("Veuillez saisir une question.");
      return;
    }

    setAskLoading(true);
    setAskError("");
    setAskResult(null);

    try {
      const response = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question.trim(),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erreur API ${response.status}: ${text}`);
      }

      const data = await response.json();
      setAskResult(data);
    } catch (err) {
      setAskError(err.message || "Erreur lors de l'appel assistant");
    } finally {
      setAskLoading(false);
    }
  }

  async function handleDiagnose() {
    setDiagLoading(true);
    setDiagError("");
    setDiagResult(null);

    try {
      const payload = {
        fault_code: faultCode.trim() || null,
        symptoms: parseSymptoms(symptomsText),
        gmao_context: gmaoContext.trim() || null,
        hours_since_maintenance:
          String(hoursSinceMaintenance).trim() !== ""
            ? Number(hoursSinceMaintenance)
            : null,
      };

      const response = await fetch(`${API_BASE}/diagnose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erreur API ${response.status}: ${text}`);
      }

      const data = await response.json();
      setDiagResult(data);
    } catch (err) {
      setDiagError(err.message || "Erreur lors du diagnostic");
    } finally {
      setDiagLoading(false);
    }
  }

  async function handleNotificationTest() {
    setNotifLoading(true);
    setNotifResult(null);
    try {
      const res = await fetch(`${API_BASE}/notifications/test`);
      const data = await res.json();
      setNotifResult(data);
    } catch (err) {
      setNotifResult({ _error: err.message || "Module notifications indisponible" });
    } finally {
      setNotifLoading(false);
    }
  }

  const dashboardSummary = useMemo(() => {
    if (!stats) {
      return {
        total: 0,
        g3: 0,
        g2: 0,
        machineCount: 0,
        topCode: "Aucun",
        alertText: "Aucune donnée chargée",
      };
    }

    const bySeverity = stats.by_severity || {};
    const criticalList = stats.critical_g3 || [];
    const byMachine = stats.by_machine || {};

    const firstCritical = criticalList.length > 0 ? criticalList[0] : null;

    return {
      total: stats.total || 0,
      g3: bySeverity[3] || bySeverity["3"] || 0,
      g2: bySeverity[2] || bySeverity["2"] || 0,
      machineCount: Object.keys(byMachine).length,
      topCode: firstCritical?.code || "Aucun",
      alertText: firstCritical
        ? `${firstCritical.code} — ${formatNumber(firstCritical.occurrences)} occurrences cumulées`
        : "Aucune alerte critique détectée",
    };
  }, [stats]);

  const topCodes = stats?.top_codes || [];
  const criticalG3 = stats?.critical_g3 || [];
  const filesLoaded = stats?.files_loaded || [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="ocp-badge">OCP</div>
          <div>
            <div className="brand-title">MINEASSIST</div>
            <div className="brand-subtitle">
              CAT 994F · Diagnostic IA · Gestion maintenance
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <StatusBadge
            online={!health?._error}
            label={!health?._error ? "Système actif" : "API hors ligne"}
          />
          <div className="session-time">
            {new Date().toLocaleDateString("fr-FR")} ·{" "}
            {new Date().toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </header>

      <nav className="main-tabs">
        {[
          ["dashboard", "GMAO Analytics"],
          ["diagnostic", "Diagnostic"],
          ["ask", "Question libre"],
          ["surveillance", "Surveillance"],
          ["system", "Système"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="critical-banner">
        <div className="critical-label">Alerte critique — intervention requise</div>
        <div className="critical-text">{dashboardSummary.alertText}</div>
      </div>

      <section className="metrics-grid">
        <MetricCard
          label="Total anomalies"
          value={formatNumber(dashboardSummary.total)}
          sub="Historique consolidé"
          tone="green"
        />
        <MetricCard
          label="Gravité critique 3"
          value={formatNumber(dashboardSummary.g3)}
          sub="Intervention prioritaire"
          tone="red"
        />
        <MetricCard
          label="Gravité élevée 2"
          value={formatNumber(dashboardSummary.g2)}
          sub="Niveau élevé"
          tone="gold"
        />
        <MetricCard
          label="Machines suivies"
          value={formatNumber(dashboardSummary.machineCount)}
          sub={stats?.summary?.top_machine || "Non déterminé"}
          tone="green"
        />
      </section>

      {activeTab === "dashboard" && (
        <>
          <div className="dashboard-grid">
            <Panel title="Évolution mensuelle des anomalies" className="span-2">
              {stats?.monthly?.length ? (
                <div className="placeholder-chart">
                  <div className="chart-title-row">
                    <span>Vue agrégée par mois et machine</span>
                    <button className="ghost-btn" onClick={loadStats}>
                      Actualiser
                    </button>
                  </div>
                  <div className="chart-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Machine</th>
                          <th>Mois</th>
                          <th>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.monthly.slice(0, 12).map((row, idx) => (
                          <tr key={idx}>
                            <td>{row.machine}</td>
                            <td>{row.month}</td>
                            <td>{formatNumber(row.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="muted-note">Aucune donnée mensuelle disponible.</div>
              )}
            </Panel>

            <Panel title="Répartition par machine">
              {stats?.by_machine ? (
                <div className="mini-kpis">
                  {Object.entries(stats.by_machine).map(([machine, total]) => (
                    <div className="mini-kpi" key={machine}>
                      <div className="mini-kpi-name">{machine}</div>
                      <div className="mini-kpi-value">{formatNumber(total)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted-note">Aucune donnée machine.</div>
              )}
            </Panel>

            <Panel title="Top codes d’anomalie" className="span-2">
              {topCodes.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Gravité</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCodes.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row["Code d'anomalie"]}</td>
                        <td>{row["Gravité"]}</td>
                        <td>{formatNumber(row.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="muted-note">Aucun top code disponible.</div>
              )}
            </Panel>

            <Panel title="Codes critiques G3">
              {criticalG3.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Occurrences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalG3.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row.code}</td>
                        <td>{formatNumber(row.occurrences)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="muted-note">Aucune criticité G3 disponible.</div>
              )}
            </Panel>
          </div>

          <div className="dashboard-grid secondary">
            <Panel title="Analyse comparative">
              <div className="compare-card green-card">
                <div className="compare-title">994F-1 — Analyse</div>
                <div className="compare-text">
                  Machine la plus exposée :{" "}
                  <strong>{stats?.summary?.top_machine || "N/A"}</strong>.
                  Source dominante : <strong>{stats?.summary?.top_source || "N/A"}</strong>.
                </div>
              </div>

              <div className="compare-card gold-card">
                <div className="compare-title">Priorité maintenance</div>
                <div className="compare-text">
                  Concentrer l’analyse sur les codes G3 récurrents, les historiques GMAO
                  et la cohérence des interventions précédentes.
                </div>
              </div>
            </Panel>

            <Panel title="Fichiers GMAO chargés">
              {filesLoaded.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fichier</th>
                      <th>Statut</th>
                      <th>Lignes</th>
                      <th>Machine</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filesLoaded.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row.file}</td>
                        <td>{row.status}</td>
                        <td>{row.rows ?? "-"}</td>
                        <td>{row.machine ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="muted-note">Aucun fichier analysé.</div>
              )}
            </Panel>
          </div>

          {statsError && <div className="error-box">{statsError}</div>}
        </>
      )}

      {activeTab === "ask" && (
        <div className="content-grid one-col">
          <Panel title="Question libre">
            <label className="field-label">Votre question</label>
            <textarea
              className="field-area"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ex: Quelles sont les causes possibles d'une perte de puissance sur une CAT 994F ?"
            />

            <div className="actions-row">
              <button className="primary-btn" onClick={handleAsk} disabled={askLoading}>
                {askLoading ? "Recherche en cours..." : "Poser la question"}
              </button>
            </div>

            {askError && <div className="error-box">{askError}</div>}

            {askResult && (
              <div className="result-block">
                <div className="result-title">Réponse de l’assistant</div>

                <div className="result-section">
                  <div className="result-label">Question</div>
                  <div className="result-box">{askResult.question}</div>
                </div>

                <div className="result-section">
                  <div className="result-label">Réponse</div>
                  <div className="result-box rich-text">{askResult.answer}</div>
                </div>

                <div className="result-section">
                  <div className="result-label">Sources</div>
                  <SourceChips sources={askResult.sources} />
                </div>

                <ResultImages images={askResult.pdf_images} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {activeTab === "diagnostic" && (
        <div className="content-grid one-col">
          <Panel title="Diagnostic de panne">
            <div className="form-grid">
              <div>
                <label className="field-label">Code défaut</label>
                <input
                  className="field-input"
                  type="text"
                  value={faultCode}
                  onChange={(e) => setFaultCode(e.target.value)}
                  placeholder="Ex: MID 036 CID 096 FMI 03"
                />
              </div>

              <div>
                <label className="field-label">Heures depuis dernière maintenance</label>
                <input
                  className="field-input"
                  type="number"
                  value={hoursSinceMaintenance}
                  onChange={(e) => setHoursSinceMaintenance(e.target.value)}
                  placeholder="Ex: 600"
                />
              </div>
            </div>

            <label className="field-label">Symptômes</label>
            <textarea
              className="field-area"
              value={symptomsText}
              onChange={(e) => setSymptomsText(e.target.value)}
              placeholder="Ex: fumée noire, bruit moteur, perte de puissance"
            />

            <label className="field-label">Contexte GMAO</label>
            <textarea
              className="field-area"
              value={gmaoContext}
              onChange={(e) => setGmaoContext(e.target.value)}
              placeholder="Ex: dernière intervention, historique panne, composants remplacés..."
            />

            <div className="actions-row">
              <button className="primary-btn" onClick={handleDiagnose} disabled={diagLoading}>
                {diagLoading ? "Diagnostic en cours..." : "Lancer le diagnostic"}
              </button>
            </div>

            {diagError && <div className="error-box">{diagError}</div>}

            {diagResult && (
              <div className="result-block">
                <div className="result-title">Résultat du diagnostic</div>

                <div className="result-section">
                  <div className="result-label">Entrée analysée</div>
                  <pre className="result-box json-box">
                    {JSON.stringify(diagResult.input, null, 2)}
                  </pre>
                </div>

                <div className="result-section">
                  <div className="result-label">Diagnostic</div>
                  <div className="result-box rich-text">{diagResult.diagnostic}</div>
                </div>

                <div className="result-section">
                  <div className="result-label">Sources</div>
                  <SourceChips sources={diagResult.sources} />
                </div>

                <ResultImages images={diagResult.pdf_images} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {activeTab === "surveillance" && (
        <div className="content-grid two-col">
          <Panel title="Test notifications">
            <div className="muted-note">
              Déclenche un test backend sur <code>/notifications/test</code>.
            </div>
            <div className="actions-row">
              <button
                className="primary-btn"
                onClick={handleNotificationTest}
                disabled={notifLoading}
              >
                {notifLoading ? "Test en cours..." : "Envoyer une notification de test"}
              </button>
            </div>

            {notifResult && (
              <pre className="result-box json-box">
                {JSON.stringify(notifResult, null, 2)}
              </pre>
            )}
          </Panel>

          <Panel title="État du module surveillance">
            <div className="system-list">
              <div className="system-row">
                <span>API santé</span>
                <strong>{health?._error ? "Indisponible" : "OK"}</strong>
              </div>
              <div className="system-row">
                <span>Notifications</span>
                <strong>À vérifier côté backend</strong>
              </div>
              <div className="system-row">
                <span>GMAO</span>
                <strong>{stats ? "Chargée" : "Non chargée"}</strong>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {activeTab === "system" && (
        <div className="content-grid two-col">
          <Panel title="Health API">
            <pre className="result-box json-box">
              {JSON.stringify(health, null, 2)}
            </pre>
          </Panel>

          <Panel title="Guide rapide">
            <ul className="guide-list">
              <li>Lancer le backend FastAPI sur le port 8000</li>
              <li>Vérifier OPENROUTER_API_KEY</li>
              <li>Indexer les documents avec POST /index-documents</li>
              <li>Placer les exports Excel dans data/gmao</li>
              <li>Activer les routes notifications si nécessaire</li>
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}