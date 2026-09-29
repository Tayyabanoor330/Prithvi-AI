const sensorMeta = {
  mq2: { label: 'MQ-2 gas', unit: 'ppm', max: 1000, icon: '◌' },
  mq135: { label: 'MQ-135 air', unit: 'AQI', max: 1000, icon: '◍' },
  rain: { label: 'Rainfall', unit: '%', max: 100, icon: '⌁' },
  soil: { label: 'Soil moisture', unit: '%', max: 100, icon: '⌂' },
  water: { label: 'Water level', unit: '%', max: 100, icon: '∿' }
};

const mapElement = document.getElementById('map');
const centralDelhi = [28.6139, 77.2090];
const centralDelhiZoom = 13;
const map = L.map(mapElement, { zoomControl: false, zoomSnap: 0.5, zoomDelta: 0.5, worldCopyJump: true }).setView(centralDelhi, centralDelhiZoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19, updateWhenZooming: false, keepBuffer: 2 }).addTo(map);
const safeRoute = [[28.6188,77.2088],[28.6154,77.2119],[28.6107,77.2144],[28.6052,77.2178]];
const riskRoute = [[28.6188,77.2088],[28.6218,77.2146],[28.6185,77.2220],[28.6118,77.2248],[28.6052,77.2178]];
let routeLine = L.polyline(safeRoute, { color: '#34775a', weight: 7, opacity: .9, lineCap: 'round', lineJoin: 'round' }).addTo(map);
const routeBounds = L.latLngBounds(safeRoute);
map.fitBounds(routeBounds.pad(0.16), { animate: false });
requestAnimationFrame(() => map.invalidateSize({ pan: false }));
new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(mapElement);
L.circleMarker([28.6188,77.2088], { radius: 8, color:'#315e8b', fillColor:'#315e8b', fillOpacity:1 }).addTo(map).bindTooltip('ESP32 gateway').openTooltip();
L.circleMarker([28.6052,77.2178], { radius: 7, color:'#34775a', fillColor:'#b9e7c6', fillOpacity:1 }).addTo(map).bindTooltip('Safe destination');

const sensorGrid = document.getElementById('sensorGrid');
function renderSensors(sensors, waterValid = true) {
  sensorGrid.innerHTML = Object.entries(sensorMeta).map(([key, meta]) => {
    const unavailable = key === 'water' && waterValid === false;
    const value = Number(sensors[key]) || 0;
    const percent = unavailable ? 0 : Math.min(100, Math.round(value / meta.max * 100));
    const isHigh = percent >= 60;
    const displayValue = unavailable ? 'N/A' : Math.round(value);
    const displayUnit = unavailable ? '' : `<span class="sensor-unit">${meta.unit}</span>`;
    return `<div class="sensor"><div class="sensor-name"><span>${meta.label}</span><span class="sensor-icon">${meta.icon}</span></div><div class="sensor-value">${displayValue} ${displayUnit}</div><div class="sensor-bar"><span style="width:${percent}%;background:${isHigh ? '#d85b4b' : '#34775a'}"></span></div></div>`;
  }).join('');
}

function renderState(data) {
  const { hazard } = data;
  const panel = document.getElementById('statusPanel');
  const level = hazard.level.toUpperCase();
  document.getElementById('hazardLevel').textContent = level;
  document.getElementById('hazardScore').textContent = `${hazard.score} / 100`;
  document.getElementById('lastUpdated').textContent = new Date(data.updatedAt).toLocaleTimeString();
  document.getElementById('connectionText').textContent = `${data.source.toUpperCase()} gateway connected`;
  document.getElementById('hazardMessage').textContent = hazard.reasons[0] || 'All monitored corridors are open.';
  document.getElementById('insightTitle').textContent = hazard.level === 'low' ? 'System ready' : 'Rerouting recommended';
  document.getElementById('insightText').textContent = hazard.reasons.join(' · ') || 'Waiting for the next telemetry packet.';
  panel.style.background = hazard.level === 'critical' ? '#712d29' : hazard.level === 'warning' ? '#684a25' : '#172629';
  document.querySelector('.status-dot').style.background = hazard.level === 'critical' ? '#ff9b8e' : hazard.level === 'warning' ? '#ffd18a' : '#b9e7c6';
  const reroute = hazard.level !== 'low';
  routeLine.setLatLngs(reroute ? riskRoute : safeRoute).setStyle({ color: reroute ? '#d85b4b' : '#34775a' });
  document.getElementById('routeBadge').textContent = reroute ? 'ROUTE B · REROUTING' : 'ROUTE A · ACTIVE';
  document.getElementById('routeBadge').style.color = reroute ? '#d85b4b' : '#34775a';
  renderSensors(data.sensors, data.waterValid);
}

async function refresh() {
  try {
    const response = await fetch('/api/readings');
    renderState(await response.json());
  } catch {
    document.getElementById('connectionText').textContent = 'Gateway unavailable';
  }
}

document.getElementById('simulateButton').addEventListener('click', async () => {
  const response = await fetch('/api/simulate', { method: 'POST' });
  renderState(await response.json());
});
document.getElementById('recenterButton').addEventListener('click', () => {
  map.flyTo(centralDelhi, centralDelhiZoom, { duration: 0.7, easeLinearity: 0.25 });
});
refresh();
setInterval(refresh, 5000);
