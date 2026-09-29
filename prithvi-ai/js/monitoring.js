/* ==========================================================================
   Live Monitoring view — dual-series line charts drawn on plain canvas
   ========================================================================== */

(function(){

  function drawDualChart(canvas, seriesA, seriesB, colorA, colorB){
    if(!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 190;
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);

    // gridlines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for(let i=1;i<4;i++){
      const y = (h/4)*i;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }

    function plot(series, color){
      const valid = series.filter(Number.isFinite);
      if(valid.length < 2) return;
      const min = Math.min(...valid), max = Math.max(...valid);
      const range = (max-min) || 1;
      ctx.beginPath();
      let drawing = false;
      series.forEach((v,i)=>{
        if(!Number.isFinite(v)){ drawing = false; return; }
        const x = (i/(series.length-1)) * w;
        const y = h - ((v-min)/range) * (h-16) - 8;
        if(!drawing){ ctx.moveTo(x,y); drawing = true; } else ctx.lineTo(x,y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    plot(seriesA, colorA);
    plot(seriesB, colorB);
  }

  function drawRawChart(canvas, seriesList, colors, maxValue){
    if(!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 190;
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for(let row=1;row<4;row++){
      const y = h*row/4;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }
    const hasData = seriesList.some(series=>series.some(value=>Number.isFinite(value)));
    if(!hasData){
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "12px sans-serif";
      ctx.fillText("Waiting for ESP32 samples", 12, 24);
      return;
    }
    seriesList.forEach((series,index)=>{
      ctx.beginPath();
      let drawing = false;
      series.forEach((value,point)=>{
        if(!Number.isFinite(value)){ drawing = false; return; }
        const x = point / Math.max(1,series.length-1) * w;
        const y = h - Math.max(0,Math.min(1,value/maxValue)) * (h-16) - 8;
        if(!drawing){ ctx.moveTo(x,y); drawing = true; }
        else ctx.lineTo(x,y);
      });
      ctx.strokeStyle = colors[index];
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  const CHART_DEFS = [
    { id:"chart-flood",     hazard:"flood",     a:"waterLevel", b:"rainfall",  ca:"#4f8ef7", cb:"#2fd9c4" },
    { id:"chart-fire",      hazard:"fire",      a:"temperature", b:"smoke",    ca:"#ff7a45", cb:"#f2a93b" },
    { id:"chart-pollution", hazard:"pollution", a:"aqi",        b:"pm25",      ca:"#b78ce0", cb:"#f0555c" },
  ];

  const NODE_ID = {
    "flood.waterLevel":"FL-01", "flood.rainfall":"FL-02", "flood.riseRate":"FL-03", "flood.flowRate":"FL-04",
    "fire.temperature":"FR-01", "fire.humidity":"FR-02", "fire.smoke":"FR-03", "fire.wind":"FR-04",
    "pollution.aqi":"PL-01", "pollution.pm25":"PL-02", "pollution.pm10":"PL-03", "pollution.visibility":"PL-04",
  };
  const CHANNEL_LABEL = {
    waterLevel:"Flood / Water level", rainfall:"Flood / Rainfall", riseRate:"Flood / Rise rate", flowRate:"Flood / Flow rate",
    temperature:"Fire / Temperature", humidity:"Fire / Humidity", smoke:"Fire / Smoke density", wind:"Fire / Wind speed",
    aqi:"Pollution / AQI", pm25:"Pollution / PM2.5", pm10:"Pollution / PM10", visibility:"Pollution / Visibility",
  };

  function renderRawFeed(s){
    const tbody = document.querySelector("#raw-feed-table tbody");
    const rows = [];
    if(s.hardwareMode && s.device.telemetry){
      const t = s.device.telemetry;
      const time = s.device.updatedAt ? new Date(s.device.updatedAt).toLocaleTimeString() : "--";
      const hardwareRows = [
        ["MQ-2 analog output", "GPIO 32", t.mq2Raw, "raw ADC"],
        ["MQ-135 analog output", "GPIO 33", t.mq135Raw, "raw ADC"],
        ["Rain sensor output", "GPIO 35", t.rainRaw, "raw ADC"],
        ["Soil sensor output", "GPIO 34", t.soilRaw, "raw ADC"],
        ["Ultrasonic echo distance", "GPIO 25/26", t.waterValid ? t.waterDistanceCm : null, t.waterValid ? "cm" : "NO ECHO"],
        ["Measured water level", "HC-SR04", t.waterValid ? t.waterLevelCm : null, t.waterValid ? "cm" : "INVALID"],
        ["Air temperature", "DHT11 / GPIO 14", t.temperature, "°C"],
        ["Air humidity", "DHT11 / GPIO 14", t.humidity, "%"],
        ["Flood edge model", "ESP32", t.floodRisk, "/100"],
        ["AQI edge model", "ESP32", t.aqi, "AQI estimate"],
      ];
      hardwareRows.forEach(([label,node,value,unit])=>rows.push(`<tr><td>${label}</td><td style="font-family:var(--font-mono);color:var(--text-dim)">${node}</td><td style="font-family:var(--font-mono)">${value === null || value === undefined ? "N/A" : Number(value).toFixed(2)} ${unit}</td><td>${value === null || value === undefined ? "UNAVAILABLE" : "LIVE"}</td><td style="color:var(--text-faint)">${time}</td></tr>`));
      tbody.innerHTML = rows.join("");
      return;
    }
    PRITHVI.sensors.HAZARDS.forEach(hazard=>{
      Object.keys(s.values[hazard]).forEach(key=>{
        const val = s.values[hazard][key];
        const level = s.risk[hazard];
        rows.push(`<tr>
          <td>${CHANNEL_LABEL[key]}</td>
          <td style="font-family:var(--font-mono);color:var(--text-dim)">${NODE_ID[hazard+"."+key]}</td>
          <td style="font-family:var(--font-mono)">${Number.isFinite(val) ? val.toFixed(2) : "N/A"}</td>
          <td><span class="hc-level ${level}" style="font-size:10px;padding:2px 7px;">${level.toUpperCase()}</span></td>
          <td style="color:var(--text-faint)">just now</td>
        </tr>`);
      });
    });
    tbody.innerHTML = rows.join("");
  }

  function render(s){
    if(PRITHVI.state.currentView !== "monitoring") return; // save cycles when not visible
    CHART_DEFS.forEach(def=>{
      const canvas = document.getElementById(def.id);
      const hist = s.history[def.hazard];
      drawDualChart(canvas, hist.map(p=>p[def.a]), hist.map(p=>p[def.b]), def.ca, def.cb);
    });
    const rawHistory = s.hardwareHistory;
    drawRawChart(document.getElementById("chart-raw-gas"),
      [rawHistory.map(p=>p.mq2Raw),rawHistory.map(p=>p.mq135Raw)], ["#d792f0","#67d6c1"], 4095);
    drawRawChart(document.getElementById("chart-raw-flood"),
      [rawHistory.map(p=>p.rainRaw),rawHistory.map(p=>p.soilRaw)], ["#4f8ef7","#2fd9c4"], 4095);
    drawRawChart(document.getElementById("chart-raw-water"),
      [rawHistory.map(p=>p.waterValid ? p.waterDistanceCm : null)], ["#4f8ef7"], 400);
    const legends = document.querySelectorAll("#view-monitoring .chart-panel .legend-row");
    if(legends.length >= 3){
      const labels = s.hardwareMode
        ? [["Water level (cm)","Rain sensor proxy (%)"],["Temperature (°C)","MQ-2 proxy (raw ADC)"],["Model AQI","PM2.5 (not installed)"]]
        : [["Water level (m)","Rainfall (mm/h)"],["Temp (°C)","Smoke (%)"],["AQI","PM2.5 (µg/m³)"]];
      legends.forEach((legend,index)=>legend.querySelectorAll(".lg").forEach((item,line)=>{
        if(labels[index] && labels[index][line]) item.lastChild.textContent = labels[index][line];
      }));
    }
    renderRawFeed(s);
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    PRITHVI.sensors.subscribe(render);
    // also redraw whenever the user opens this tab (canvas sizes are 0 while hidden)
    document.querySelectorAll('.nav-link[data-view="monitoring"]').forEach(btn=>{
      btn.addEventListener("click", ()=> setTimeout(()=>render(PRITHVI.sensors.getState()), 30));
    });
  });

})();
