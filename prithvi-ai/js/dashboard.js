/* ==========================================================================
   Dashboard view
   ========================================================================== */

(function(){

  const METRIC_UNITS = {
    waterLevel:"m", rainfall:"mm/h", riseRate:"m/h", flowRate:"m³/s",
    temperature:"°C", humidity:"%", smoke:"%", wind:"km/h",
    aqi:"", pm25:"µg/m³", pm10:"µg/m³", visibility:"km",
  };

  function fmt(hazard, key, val){
    if(val === null || val === undefined || !Number.isFinite(Number(val))) return "N/A";
    let decimals = 1;
    if(key === "riseRate") decimals = 2;
    if(["waterLevel","visibility"].includes(key)) decimals = 1;
    if(["rainfall","flowRate","temperature","humidity","smoke","wind","aqi","pm25","pm10"].includes(key)) decimals = 0;
    return val.toFixed(decimals);
  }

  function renderHardwarePanel(s){
    const status = document.getElementById("hardware-connection");
    const grid = document.getElementById("hardware-reading-grid");
    if(!status || !grid) return;
    const device = s.device;
    if(s.demo){
      status.className = "hardware-connection waiting";
      status.textContent = "DEMO OVERRIDE";
      grid.innerHTML = `<div class="hardware-empty">Scenario data is active. Live device readings resume when Demo Mode is turned off.</div>`;
      return;
    }
    const connected = device.connected && s.hardwareMode;
    status.className = "hardware-connection " + (connected ? "connected" : device.status);
    status.textContent = connected ? "ESP32 CONNECTED" :
      (device.status === "stale" ? "DATA STALE" : device.status === "offline" ? "BACKEND OFFLINE" : "WAITING FOR ESP32");

    if(!s.hardwareMode || !device.telemetry){
      grid.innerHTML = `<div class="hardware-empty">${device.status === "offline" ? "Backend is unavailable. Start the Node service to receive device readings." : "Waiting for the first ESP32 telemetry packet."}</div>`;
      return;
    }

    const t = device.telemetry;
    const measured = (value, unit="") => value === null || value === undefined || !Number.isFinite(Number(value))
      ? "N/A" : Number(value).toFixed(1) + (unit ? ` <small>${unit}</small>` : "");
    const raw = value => value === null || value === undefined ? "N/A" : `${Math.round(value)} <small>ADC</small>`;
    const timestamp = device.updatedAt ? new Date(device.updatedAt).toLocaleTimeString() : "--";
    const readings = [
      ["MQ-2 sensor", raw(t.mq2Raw)],
      ["MQ-135 sensor", raw(t.mq135Raw)],
      ["Rain sensor", raw(t.rainRaw)],
      ["Soil sensor", raw(t.soilRaw)],
      ["Air temperature", measured(t.temperature,"°C")],
      ["Humidity", measured(t.humidity,"%")],
      ["Ultrasonic distance", t.waterValid ? measured(t.waterDistanceCm,"cm") : "NO ECHO"],
      ["Measured water level", t.waterValid ? measured(t.waterLevelCm,"cm") : "N/A"],
      ["Flood edge model", measured(t.floodRisk,"/100")],
      ["AQI model estimate", measured(t.aqi,"AQI")],
      ["Device alert", t.alert ? "ACTIVE" : "CLEAR"],
      ["Last packet", timestamp],
    ];
    grid.innerHTML = readings.map(([label,value])=>`<div class="hardware-reading"><span>${label}</span><strong>${value}</strong></div>`).join("") +
      `<p class="hardware-note">MQ-2 and MQ-135 are shown as raw ADC counts. They are sensor proxies, not calibrated ppm or particulate measurements. No wind or optical PM sensor is installed.</p>`;
  }

  function renderLiveLabels(card, hazard, live){
    const captions = hazard === "flood"
      ? (live ? {waterLevel:["Water level", "cm"], rainfall:["Rain sensor proxy", "%"], riseRate:["Level change", "cm/h"], flowRate:["Flow rate", ""]}
        : {waterLevel:["Water level", "m"], rainfall:["Rainfall", "mm/h"], riseRate:["Rate of rise", "m/h"], flowRate:["Flow rate", "m³/s"]})
      : hazard === "fire"
        ? (live ? {temperature:["Temperature", "°C"],humidity:["Humidity", "%"],smoke:["MQ-2 raw signal", "ADC"],wind:["Wind sensor", ""]}
          : {temperature:["Temperature", "°C"],humidity:["Humidity", "%"],smoke:["Smoke density", "%"],wind:["Wind speed", "km/h"]})
        : (live ? {aqi:["Model AQI", ""],pm25:["PM2.5 sensor", ""],pm10:["PM10 sensor", ""],visibility:["Visibility sensor", ""]}
          : {aqi:["AQI", ""],pm25:["PM2.5", "µg/m³"],pm10:["PM10", "µg/m³"],visibility:["Visibility", "km"]});
    Object.entries(captions).forEach(([key,[label,unit]])=>{
      const metric = card.querySelector(`[data-m="${key}"]`);
      const caption = metric && metric.closest(".hc-metric");
      if(!caption) return;
      const labelEl = caption.querySelector(".m-label");
      if(labelEl) labelEl.textContent = label;
      const unitEl = metric.querySelector(".m-unit");
      const hasValue = Number.isFinite(Number(metric.textContent.trim()));
      if(unit && hasValue){
        if(unitEl) unitEl.textContent = unit;
        else metric.insertAdjacentHTML("beforeend", `<span class="m-unit">${unit}</span>`);
      } else if(unitEl){
        unitEl.remove();
      }
    });
  }

  function drawSpark(canvas, series, color){
    const validSeries = series.filter(Number.isFinite);
    if(!canvas || !validSeries.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 260, h = canvas.clientHeight || 46;
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const min = Math.min(...validSeries), max = Math.max(...validSeries);
    const range = (max-min) || 1;
    ctx.beginPath();
    validSeries.forEach((v,i)=>{
      const x = (i/(validSeries.length-1||1)) * w;
      const y = h - ((v-min)/range) * (h-6) - 3;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
    // fill under line
    ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath();
    ctx.fillStyle = color.replace(")", ",0.12)").replace("rgb","rgba");
    ctx.fill();
  }

  const HAZARD_COLOR = { flood:"rgb(79,142,247)", fire:"rgb(255,122,69)", pollution:"rgb(183,140,224)" };
  const HAZARD_METRIC_KEY = { flood:"waterLevel", fire:"temperature", pollution:"aqi" };
  let realMap = null;
  let realRouteA = null;
  let realRouteB = null;
  let realBlockedMarker = null;
  let realPollutionZones = [];

  const DELHI_ROUTE_A = [[28.6442,77.2166],[28.6373,77.2182],[28.6285,77.2194],[28.6128,77.2295],[28.6418,77.2250],[28.6602,77.2050],[28.6760,77.1888]];
  const DELHI_ROUTE_B = [[28.6442,77.2166],[28.6488,77.2045],[28.6575,77.1963],[28.6672,77.1915],[28.6760,77.1888]];

  function initRealMap(){
    const mapEl = document.getElementById("real-route-map");
    if(!mapEl || typeof L === "undefined" || realMap) return;
    realMap = L.map(mapEl, { zoomControl:true, scrollWheelZoom:false }).setView([28.635,77.207], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom:19,
      attribution:'&copy; OpenStreetMap contributors',
    }).addTo(realMap);
    realRouteA = L.polyline(DELHI_ROUTE_A, { color:"#1688e8", weight:7, opacity:0.95 }).addTo(realMap).bindTooltip("Route A - Main corridor", { permanent:true, direction:"top", className:"route-tooltip-a" });
    realRouteB = L.polyline(DELHI_ROUTE_B, { color:"#22a66f", weight:7, opacity:0.38, dashArray:"10 8" }).addTo(realMap).bindTooltip("Route B - Ridge Road", { permanent:true, direction:"top", className:"route-tooltip-b" });
    realBlockedMarker = L.circleMarker(DELHI_ROUTE_A[3], { radius:10, color:"#ffffff", weight:2, fillColor:"#b8444d", fillOpacity:0 }).addTo(realMap).bindTooltip("Route A blocked by floodwater", { permanent:true, direction:"top" });
    [[28.650,77.205,900],[28.635,77.235,1050],[28.615,77.205,850]].forEach((zone, index)=>{
      realPollutionZones.push(L.circle([zone[0],zone[1]], { radius:zone[2], color:"#e17842", weight:2, dashArray:"8 6", fillColor:"#c46a42", fillOpacity:0 }).addTo(realMap).bindTooltip("High pollution region " + (index + 1), { direction:"top" }));
    });
    L.circleMarker(DELHI_ROUTE_A[0], { radius:8, color:"#ffffff", weight:3, fillColor:"#172635", fillOpacity:1 }).addTo(realMap).bindTooltip("Start", { permanent:true, direction:"bottom" });
    L.circleMarker(DELHI_ROUTE_A[DELHI_ROUTE_A.length-1], { radius:9, color:"#ffffff", weight:3, fillColor:"#22a66f", fillOpacity:1 }).addTo(realMap).bindTooltip("Community rain shelter", { permanent:true, direction:"top" });
    updateRealRouteMap("normal");
  }

  function updateRealRouteMap(mode){
    if(!realRouteA || !realRouteB) return;
    const rerouting = mode === "reroute";
    realRouteA.setStyle({ weight:rerouting ? 5 : 9, opacity:rerouting ? 0.3 : 0.95 });
    realRouteB.setStyle({ weight:rerouting ? 10 : 7, opacity:rerouting ? 0.98 : 0.38 });
    realBlockedMarker.setStyle({ opacity:rerouting ? 1 : 0, fillOpacity:rerouting ? 0.95 : 0 });
    realPollutionZones.forEach(zone=>zone.setStyle({ opacity:mode === "pollution" ? 0.95 : 0, fillOpacity:mode === "pollution" ? 0.28 : 0 }));
  }

  function wireMapViewSwitch(){
    const wrap = document.querySelector(".route-map-wrap");
    document.querySelectorAll("[data-map-view]").forEach(button=>{
      button.addEventListener("click", ()=>{
        const real = button.dataset.mapView === "real";
        document.querySelectorAll("[data-map-view]").forEach(item=>item.classList.toggle("active", item === button));
        wrap.classList.toggle("real-active", real);
        if(real){
          initRealMap();
          if(realMap) setTimeout(()=>realMap.invalidateSize(), 0);
        }
      });
    });
  }

  function riskAccent(level){
    return { normal:"var(--safe)", warning:"var(--warn)", high:"#ff8f4d", critical:"var(--danger)" }[level];
  }

  function renderCards(s){
    document.querySelectorAll(".hazard-card").forEach(card=>{
      const hazard = card.dataset.hazard;
      const values = s.values[hazard];
      const level = s.risk[hazard];
      const score = s.riskScore[hazard];
      const trend = s.trend[hazard];

      card.querySelectorAll("[data-m]").forEach(el=>{
        const key = el.dataset.m;
        const unit = s.hardwareMode
          ? ({waterLevel:"cm",rainfall:"%",riseRate:"cm/h",smoke:"ADC"}[key] || "")
          : (METRIC_UNITS[key] || "");
        const unavailable = s.hardwareMode && ((hazard === "flood" && key === "flowRate") ||
          (hazard === "fire" && key === "wind") ||
          (hazard === "pollution" && ["pm25","pm10","visibility"].includes(key)));
        const value = unavailable ? null : values[key];
        el.innerHTML = fmt(hazard,key,value) + (unit && value !== null ? `<span class="m-unit">${unit}</span>` : "");
      });
      renderLiveLabels(card,hazard,s.hardwareMode);

      const levelEl = card.querySelector("[data-level]");
      levelEl.textContent = level.toUpperCase() === "HIGH" ? "HIGH RISK" : level.toUpperCase();
      levelEl.className = "hc-level " + level;

      const fill = card.querySelector("[data-fill]");
      fill.style.width = score.toFixed(0) + "%";
      fill.style.background = riskAccent(level);

      const trendEl = card.querySelector("[data-trend]");
      trendEl.className = "trend " + trend;
      trendEl.textContent = trend === "up" ? "▲ rising" : (trend === "down" ? "▼ falling" : "● steady");

      const spark = card.querySelector("[data-spark]");
      const series = s.history[hazard].map(p=>p[HAZARD_METRIC_KEY[hazard]]);
      drawSpark(spark, series, HAZARD_COLOR[hazard]);
    });
  }

  function renderRouteDecision(s){
    const panel = document.getElementById("route-panel");
    if(!panel) return;
    const routeInfo = s.route || { title:"Primary route active", route:"Route A — Main corridor remains open", shelter:"Rain shelter not required", note:"No flood reroute required." };
    const pollutionActive = s.demoScenario === "pollution" && s.risk.pollution !== "normal";
    const activeMode = pollutionActive ? "pollution" : (routeInfo.mode || "normal");
    const pollutionZones = document.getElementById("pollution-zones");
    const pollutionAdvisory = document.getElementById("pollution-advisory");
    if(pollutionActive){
      panel.innerHTML = `<div class="ab-title" style="margin-bottom:8px;">Pollution health advisory active</div><div style="margin-bottom:6px;"><b>Air quality:</b> High-risk regions marked on the map</div><div style="margin-bottom:6px;"><b>Recommended action:</b> Remain indoors and avoid strenuous outdoor activity.</div><div style="color:var(--text-dim);font-size:12.5px;">Keep windows closed and limit exposure until air quality improves.</div>`;
    } else {
      panel.innerHTML = `<div class="ab-title" style="margin-bottom:8px;">${routeInfo.title}</div><div style="margin-bottom:6px;"><b>Selected route:</b> ${routeInfo.route}</div><div style="margin-bottom:6px;"><b>Rain shelter:</b> ${routeInfo.shelter}</div><div style="color:var(--text-dim);font-size:12.5px;">${routeInfo.note}</div>`;
    }
    if(pollutionZones) pollutionZones.setAttribute("opacity", pollutionActive ? "1" : "0");
    if(pollutionAdvisory) pollutionAdvisory.hidden = !pollutionActive;
    panel.innerHTML = `
      <div class="ab-title" style="margin-bottom:8px;">${routeInfo.title}</div>
      <div style="margin-bottom:6px;"><b>Selected route:</b> ${routeInfo.route}</div>
      <div style="margin-bottom:6px;"><b>Rain shelter:</b> ${routeInfo.shelter}</div>
      <div style="color:var(--text-dim);font-size:12.5px;">${routeInfo.note}</div>
    `;

    const routeA = document.getElementById("routeA");
    const routeB = document.getElementById("routeB");
    const blockedMarker = document.getElementById("route-blocked");
    if(blockedMarker) blockedMarker.setAttribute("opacity", activeMode === "reroute" ? "1" : "0");
    if(routeA && routeB){
      if(activeMode === "pollution"){
        routeA.setAttribute("stroke-opacity", "0.12");
        routeB.setAttribute("stroke-opacity", "0.12");
      } else if(activeMode === "reroute"){
        routeA.setAttribute("stroke", "#4aa3ff");
        routeA.setAttribute("stroke-opacity", "0.28");
        routeA.setAttribute("stroke-width", "12");
        routeB.setAttribute("stroke", "#39d08f");
        routeB.setAttribute("stroke-opacity", "1");
        routeB.setAttribute("stroke-width", "16");
      } else {
        routeA.setAttribute("stroke", "#4aa3ff");
        routeA.setAttribute("stroke-opacity", "1");
        routeA.setAttribute("stroke-width", "16");
        routeB.setAttribute("stroke", "#39d08f");
        routeB.setAttribute("stroke-opacity", "0.35");
        routeB.setAttribute("stroke-width", "12");
      }
    }
    initRealMap();
    updateRealRouteMap(activeMode);
  }

  function renderRiskStrip(s){
    const el = document.getElementById("overall-risk-level");
    const level = s.risk.overall;
    el.textContent = level === "high" ? "High Risk" : level.charAt(0).toUpperCase()+level.slice(1);
    el.style.color = riskAccent(level);

    const track = document.getElementById("risk-track");
    const order = ["normal","warning","high","critical"];
    const idx = order.indexOf(level);
    track.querySelectorAll(":scope > div").forEach((seg,i)=>{
      seg.classList.toggle("dim", i > idx);
    });

    const pill = document.getElementById("global-status-pill");
    const text = document.getElementById("global-status-text");
    pill.className = "status-pill " + (level==="normal" ? "safe" : (level==="warning" ? "warn" : "danger"));
    text.textContent = level==="normal" ? "ALL SYSTEMS NORMAL" : (level==="warning" ? "WARNING CONDITIONS DETECTED" : (level==="high" ? "HIGH RISK — MONITOR CLOSELY" : "CRITICAL — IMMEDIATE ACTION ADVISED"));
    if(level === "normal" && s.hardwareMode && !s.demo){
      if(!s.device.connected){
        pill.className = "status-pill warn";
        text.textContent = "DEVICE CONNECTION LOST — CHECK LIVE DATA";
      } else if(s.device.telemetry && !s.device.telemetry.waterValid){
        pill.className = "status-pill warn";
        text.textContent = "WATER SENSOR FAULT — LEVEL UNAVAILABLE";
      }
    }
  }

  function alertCard(hazard, s){
    const level = s.risk[hazard];
    const info = PRITHVI.ALERT_INFO[hazard];
    const bannerClass = level === "critical" || level === "high" ? "" : "warning";
    const trend = s.trend[hazard] === "up" ? "Rising" : (s.trend[hazard]==="down" ? "Falling" : "Stable");
    return `
      <div class="alert-banner ${bannerClass}">
        <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.8" fill="currentColor"/></svg>
        <div style="flex:1">
          <div class="ab-title">${PRITHVI.HAZARD_LABEL[hazard]} — ${level==="high"?"High Risk":level.charAt(0).toUpperCase()+level.slice(1)}</div>
          <div style="color:var(--text-dim);font-size:12.5px;">Risk score ${s.riskScore[hazard].toFixed(0)}/100 · Trend: ${trend}</div>
          <div class="ab-grid">
            <div><b>Affected area:</b> ${info.area}</div>
            <div><b>Safe zone:</b> ${info.safeZone}</div>
            <div style="grid-column:1/-1;"><b>Recommended action:</b> ${info.action}</div>
          </div>
        </div>
      </div>`;
  }

  function renderAlerts(s){
    const list = document.getElementById("dash-alert-list");
    const active = PRITHVI.sensors.HAZARDS.filter(h => s.risk[h] !== "normal");
    const waterFault = s.hardwareMode && s.device.telemetry && !s.device.telemetry.waterValid;
    const deviceOffline = s.hardwareMode && !s.device.connected;
    const deviceWarning = waterFault
      ? `<div class="alert-banner warning"><div><div class="ab-title">Water-level sensor unavailable</div><div>Check HC-SR04 power, shared ground, TRIG/ECHO wiring, and use a voltage divider on the ESP32 ECHO input. Flood model output may be using its last valid water sample.</div></div></div>`
      : deviceOffline
        ? `<div class="alert-banner warning"><div><div class="ab-title">ESP32 telemetry is stale</div><div>Check Wi-Fi, backend availability, and the device connection before relying on the displayed readings.</div></div></div>`
        : "";
    if(active.length === 0 && !deviceWarning){
      list.innerHTML = `<div class="panel" style="color:var(--text-dim);font-size:13px;">No active alerts. All monitored zones are within normal parameters.</div>`;
      return;
    }
    list.innerHTML = deviceWarning + active.sort((a,b)=> s.riskScore[b]-s.riskScore[a]).map(h=>alertCard(h,s)).join("");
  }

  function render(s){
    renderHardwarePanel(s);
    renderCards(s);
    renderRouteDecision(s);
    renderRiskStrip(s);
    renderAlerts(s);
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    PRITHVI.sensors.subscribe(render);
    render(PRITHVI.sensors.getState());
    wireMapViewSwitch();

    document.getElementById("dash-refresh").addEventListener("click", ()=>{
      PRITHVI.sensors.refreshOnce();
      PRITHVI.toast("Sensor readings refreshed.");
    });
  });

})();
