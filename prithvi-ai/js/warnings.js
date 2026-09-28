/* ==========================================================================
   Early Warnings view — full detail card per hazard
   ========================================================================== */

(function(){

  function levelLabel(level){
    return level === "high" ? "High Risk" : level.charAt(0).toUpperCase()+level.slice(1);
  }

  function card(hazard, s){
    const level = s.risk[hazard];
    const info = PRITHVI.ALERT_INFO[hazard];
    const trendWord = s.trend[hazard] === "up" ? "Rising" : (s.trend[hazard]==="down" ? "Falling" : "Stable");
    const bannerClass = level === "normal" ? "safe" : (level === "warning" ? "warning" : "");
    const v = s.values[hazard];

    let conditionsLine = "";
    const value = (key, digits=1) => Number.isFinite(v[key]) ? v[key].toFixed(digits) : "N/A";
    if(hazard === "flood") conditionsLine = s.hardwareMode
      ? `Water level ${value("waterLevel")} cm, rain sensor ${value("rainfall",0)}%, edge-model flood risk ${s.riskScore.flood.toFixed(0)}/100`
      : `Water level ${value("waterLevel")} m, rising ${value("riseRate",2)} m/h, rainfall ${value("rainfall",0)} mm/h`;
    if(hazard === "fire") conditionsLine = s.hardwareMode
      ? `${value("temperature",0)}°C, ${value("humidity",0)}% humidity, MQ-2 raw signal ${value("smoke",0)} ADC (smoke/gas proxy; no dedicated fire sensor)`
      : `${value("temperature",0)}°C, ${value("humidity",0)}% humidity, smoke ${value("smoke",0)}%, wind ${value("wind",0)} km/h`;
    if(hazard === "pollution") conditionsLine = s.hardwareMode
      ? `Model AQI ${value("aqi",0)}, MQ-135 raw signal ${value("pm25",0)} ADC; PM and visibility sensors unavailable`
      : `AQI ${value("aqi",0)}, PM2.5 ${value("pm25",0)} µg/m³, visibility ${value("visibility")} km`;

    return `
      <div class="alert-banner ${bannerClass}">
        <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.8" fill="currentColor"/></svg>
        <div style="flex:1">
          <div class="ab-title">${PRITHVI.HAZARD_LABEL[hazard]} — ${levelLabel(level)} <span style="color:var(--text-faint);font-weight:400;">(score ${s.riskScore[hazard].toFixed(0)}/100, ${trendWord.toLowerCase()})</span></div>
          <div class="ab-grid">
            <div style="grid-column:1/-1;"><b>Current conditions:</b> ${conditionsLine}</div>
            <div><b>Affected area:</b> ${level==="normal" ? "None — monitored zone stable" : info.area}</div>
            <div><b>Safe zone / shelter:</b> ${info.safeZone}</div>
            <div style="grid-column:1/-1;"><b>Recommended action:</b> ${level==="normal" ? info.normalNote : info.action}</div>
          </div>
        </div>
      </div>`;
  }

  function render(s){
    const list = document.getElementById("warnings-full-list");
    if(!list) return;
    const sensorWarning = s.hardwareMode && s.device.telemetry && !s.device.telemetry.waterValid
      ? `<div class="alert-banner warning"><div><div class="ab-title">Water-level sensor unavailable</div><div>Check HC-SR04 power, shared ground, TRIG/ECHO wiring, and add a voltage divider before the ESP32 ECHO pin. The flood model may be using its last valid water sample.</div></div></div>`
      : s.hardwareMode && !s.device.connected
        ? `<div class="alert-banner warning"><div><div class="ab-title">ESP32 telemetry is stale</div><div>Check the ESP32 Wi-Fi connection and backend before acting on the last displayed values.</div></div></div>`
        : "";
    list.innerHTML = sensorWarning + PRITHVI.sensors.HAZARDS
      .slice()
      .sort((a,b)=> s.riskScore[b]-s.riskScore[a])
      .map(h=>card(h,s)).join("");
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    PRITHVI.sensors.subscribe(render);
    render(PRITHVI.sensors.getState());
  });

})();
