/* ==========================================================================
   Early Warnings view — full detail card per hazard
   ========================================================================== */

(function () {
  function levelLabel(level) {
    return level === "high"
      ? "High Risk"
      : level.charAt(0).toUpperCase() + level.slice(1);
  }

  function card(hazard, s) {
    const level = s.risk[hazard];
    const info = PRITHVI.ALERT_INFO[hazard];

    const trendWord =
      s.trend[hazard] === "up"
        ? "Rising"
        : s.trend[hazard] === "down"
          ? "Falling"
          : "Stable";

    const bannerClass =
      level === "normal" ? "safe" : level === "warning" ? "warning" : "";

    const v = s.values[hazard];

    let conditionsLine = "";


    const value = (key, digits = 1) =>
      Number.isFinite(v[key]) ? v[key].toFixed(digits) : "N/A";

    if (hazard === "flood") {
      conditionsLine = s.hardwareMode
        ? `Water level ${value("waterLevel")} cm, rain sensor ${value("rainfall", 0)}%, edge-model flood risk ${s.riskScore.flood.toFixed(0)}/100`
        : `Water level ${value("waterLevel")} m, rising ${value("riseRate", 2)} m/h, rainfall ${value("rainfall", 0)} mm/h`;
    }

    if (hazard === "fire") {
      conditionsLine = s.hardwareMode
        ? `${value("temperature", 0)}°C, ${value("humidity", 0)}% humidity, MQ-2 raw signal ${value("smoke", 0)} ADC (smoke/gas proxy; no dedicated fire sensor)`
        : `${value("temperature", 0)}°C, ${value("humidity", 0)}% humidity, smoke ${value("smoke", 0)}%, wind ${value("wind", 0)} km/h`;
    }

    if (hazard === "pollution") {
      conditionsLine = s.hardwareMode
        ? `Model AQI ${value("aqi", 0)}, MQ-135 raw signal ${value("pm25", 0)} ADC; PM and visibility sensors unavailable`
        : `AQI ${value("aqi", 0)}, PM2.5 ${value("pm25", 0)} µg/m³, visibility ${value("visibility")} km`;
    }



    return `
      <div class="alert-banner ${bannerClass}">

        <svg class="alert-icon"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             stroke-width="1.8">

          <path d="M12 3 2 20h20L12 3Z"/>
          <path d="M12 10v4"/>
          <circle cx="12" cy="17" r="0.8" fill="currentColor"/>

        </svg>

        <div style="flex:1">

          <div class="ab-title">
            ${PRITHVI.HAZARD_LABEL[hazard]}
            — ${levelLabel(level)}

            <span style="color:var(--text-faint);font-weight:400;">
              (score ${s.riskScore[hazard].toFixed(0)}/100,
              ${trendWord.toLowerCase()})
            </span>
          </div>

          <div class="ab-grid">

            <div style="grid-column:1/-1;">
              <b>Current conditions:</b>
              ${conditionsLine}
            </div>

            <div>
              <b>Affected area:</b>
              ${level === "normal" ? "None — monitored zone stable" : info.area}
            </div>

            <div>
              <b>Safe zone / shelter:</b>
              ${info.safeZone}
            </div>

            <div style="grid-column:1/-1;">
              <b>Recommended action:</b>
              ${level === "normal" ? info.normalNote : info.action}
            </div>

          </div>

        </div>

      </div>
    `;
  }

  /* ========================================================================
     DISASTER POPUP
     ======================================================================== */

  let lastAlertKey = null;

  function showDisasterPopup(hazard, level, s) {
    // Popup only for serious conditions
    if (level !== "high" && level !== "critical") {
      return;
    }

    const alertKey = `${hazard}-${level}`;

    // Do not repeatedly show the same alert
    if (lastAlertKey === alertKey) {
      return;
    }

    lastAlertKey = alertKey;

    const info = PRITHVI.ALERT_INFO[hazard];

    // Remove an existing popup
    const existingPopup = document.getElementById("disaster-alert-popup");

    if (existingPopup) {
      existingPopup.remove();
    }

    /* ----------------------------------------------------------------------
       Create popup
       ---------------------------------------------------------------------- */

    const popup = document.createElement("div");

    popup.id = "disaster-alert-popup";

    popup.innerHTML = `

      <div class="disaster-popup-box">

        <button
          class="disaster-close"
          id="disaster-close"
          aria-label="Close alert">

          ×

        </button>


        <div class="disaster-alert-icon">
          ⚠
        </div>


        <div class="disaster-alert-title">
          DISASTER ALERT
        </div>


        <div class="disaster-alert-hazard">

          ${PRITHVI.HAZARD_LABEL[hazard]}
          — ${levelLabel(level)}

        </div>


        <div class="disaster-alert-score">

          Risk Score:

          <strong>
            ${s.riskScore[hazard].toFixed(0)}/100
          </strong>

        </div>


        <div class="disaster-alert-content">

          <p>

            <strong>Affected area:</strong>

            ${info.area}

          </p>


          <p>

            <strong>
              Current conditions indicate a
              ${level}
              ${PRITHVI.HAZARD_LABEL[hazard].toLowerCase()}
              risk.
            </strong>

          </p>


          <p>

            <strong>Recommended action:</strong>
            <br>

            ${info.action}

          </p>

        </div>


        <button
          class="disaster-close-button"
          id="disaster-close-button">

          CLOSE ALERT

        </button>

      </div>

    `;

    /* ----------------------------------------------------------------------
       Overlay
       ---------------------------------------------------------------------- */

    popup.style.position = "fixed";
    popup.style.inset = "0";
    popup.style.width = "100%";
    popup.style.height = "100%";

    popup.style.background = "rgba(0, 0, 0, 0.7)";

    popup.style.display = "flex";
    popup.style.alignItems = "center";
    popup.style.justifyContent = "center";

    popup.style.zIndex = "99999";

    /* ----------------------------------------------------------------------
       Popup styles
       ---------------------------------------------------------------------- */

    const style = document.createElement("style");

    style.id = "disaster-alert-popup-style";

    style.textContent = `

      .disaster-popup-box {

        position: relative;

        width: 430px;

        max-width: 90%;

        background: #151922;

        color: white;

        padding: 30px;

        border-radius: 16px;

        border: 2px solid #ff4444;

        box-shadow:
          0 15px 50px rgba(0,0,0,0.6);

        font-family: inherit;

        animation:
          disasterPopupIn 0.25s ease-out;

      }


      @keyframes disasterPopupIn {

        from {
          opacity: 0;
          transform: scale(0.92);
        }

        to {
          opacity: 1;
          transform: scale(1);
        }

      }


      .disaster-close {

        position: absolute;

        right: 15px;
        top: 10px;

        background: none;

        border: none;

        color: #aaa;

        font-size: 28px;

        cursor: pointer;

      }


      .disaster-close:hover {
        color: white;
      }


      .disaster-alert-icon {

        font-size: 42px;

        color: #ff4444;

        margin-bottom: 8px;

      }


      .disaster-alert-title {

        font-size: 24px;

        font-weight: 700;

        color: #ff4444;

        margin-bottom: 8px;

      }


      .disaster-alert-hazard {

        font-size: 20px;

        font-weight: 600;

        margin-bottom: 10px;

      }


      .disaster-alert-score {

        font-size: 14px;

        color: #aaa;

        margin-bottom: 20px;

      }


      .disaster-alert-content {

        background:
          rgba(255,255,255,0.06);

        padding: 15px;

        border-radius: 10px;

        line-height: 1.6;

        font-size: 14px;

      }


      .disaster-alert-content p {

        margin: 0 0 12px 0;

      }


      .disaster-alert-content p:last-child {

        margin-bottom: 0;

      }


      .disaster-close-button {

        width: 100%;

        margin-top: 20px;

        padding: 12px;

        border: none;

        border-radius: 8px;

        background: #ff4444;

        color: white;

        font-weight: 700;

        cursor: pointer;

        font-size: 14px;

      }


      .disaster-close-button:hover {

        opacity: 0.85;

      }

    `;

    document.head.appendChild(style);

    document.body.appendChild(popup);

    /* ----------------------------------------------------------------------
       Close popup
       ---------------------------------------------------------------------- */

    function closePopup() {
      popup.remove();

      style.remove();
    }

    document
      .getElementById("disaster-close")
      .addEventListener("click", closePopup);

    document
      .getElementById("disaster-close-button")
      .addEventListener("click", closePopup);
  }

  /* ========================================================================
     RENDER
     ======================================================================== */

  function render(s) {
    const list = document.getElementById("warnings-full-list");
    if (!list) return;

    const sensorWarning =
      s.hardwareMode && s.device.telemetry && !s.device.telemetry.waterValid
        ? `<div class="alert-banner warning">
             <div>
               <div class="ab-title">Water-level sensor unavailable</div>
               <div>
                 Check HC-SR04 power, shared ground, TRIG/ECHO wiring,
                 and add a voltage divider before the ESP32 ECHO pin.
                 The flood model may be using its last valid water sample.
               </div>
             </div>
           </div>`
        : s.hardwareMode && !s.device.connected
          ? `<div class="alert-banner warning">
               <div>
                 <div class="ab-title">ESP32 telemetry is stale</div>
                 <div>
                   Check the ESP32 Wi-Fi connection and backend before
                   acting on the last displayed values.
                 </div>
               </div>
             </div>`
          : "";

    list.innerHTML =
      sensorWarning +
      PRITHVI.sensors.HAZARDS.slice()
        .sort((a, b) => s.riskScore[b] - s.riskScore[a])
        .map((h) => card(h, s))
        .join("");

    /* ----------------------------------------------------------------------
       Find the highest-risk active hazard
       ---------------------------------------------------------------------- */

    const activeHazards = PRITHVI.sensors.HAZARDS.filter((hazard) => {
      const level = s.risk[hazard];
      return level === "high" || level === "critical";
    });

    if (activeHazards.length === 0) {
      return;
    }

    /* ----------------------------------------------------------------------
       Show alert for the highest-risk hazard only
       ---------------------------------------------------------------------- */

    activeHazards.sort((a, b) => s.riskScore[b] - s.riskScore[a]);

    const highestRiskHazard = activeHazards[0];

    showDisasterPopup(highestRiskHazard, s.risk[highestRiskHazard], s);
  }

  /* ========================================================================
     INITIALIZE
     ======================================================================== */

  document.addEventListener("DOMContentLoaded", () => {
    PRITHVI.sensors.subscribe(render);

    render(PRITHVI.sensors.getState());
  });
})();
