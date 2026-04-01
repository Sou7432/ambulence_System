(function () {
  const boot = document.getElementById("ambusync-boot");
  const mapsKey = boot?.dataset?.mapsKey;
  if (mapsKey) {
    window.AMBUSYNC_MAPS_KEY = mapsKey;
  }

  const form = document.getElementById("request-form");
  const statusEl = document.getElementById("submit-status");
  const mapStatus = document.getElementById("map-status");
  const locateBtn = document.getElementById("btn-locate");
  const latInput = document.getElementById("latitude");
  const lngInput = document.getElementById("longitude");
  const hospitalSelect = document.getElementById("preferred-hospital");
  const donePanel = document.getElementById("done-panel");
  const doneText = document.getElementById("done-text");

  let map = null;
  let marker = null;

  async function loadHospitals() {
    try {
      const res = await fetch("/api/hospitals");
      const data = await res.json();
      for (const h of data.hospitals || []) {
        const opt = document.createElement("option");
        opt.value = h.id;
        opt.textContent = h.name;
        hospitalSelect.appendChild(opt);
      }
    } catch {
      /* optional */
    }
  }
  loadHospitals();

  function placeMarker(position) {
    if (!map || !window.google || !google.maps) return;
    if (!marker) {
      marker = new google.maps.Marker({ map, position });
    } else {
      marker.setPosition(position);
    }
    map.setCenter(position);
    map.setZoom(15);
  }

  window.ambusyncPatientInitMap = function () {
    const el = document.getElementById("map");
    if (!el || !window.google) return;
    map = new google.maps.Map(el, {
      center: { lat: 22.5726, lng: 88.3639 },
      zoom: 11,
    });
    mapStatus.textContent = "Tap the map or use “Use my location” to set the pickup point.";
    map.addListener("click", (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      latInput.value = lat;
      lngInput.value = lng;
      placeMarker({ lat, lng });
    });
  };

  if (!window.AMBUSYNC_MAPS_KEY) {
    const el = document.getElementById("map");
    if (el) {
      el.classList.add("map-placeholder");
      el.innerHTML =
        "Add <code>GOOGLE_MAPS_API_KEY</code> for map pick, or use <strong>Use my location</strong> below.";
    }
  }

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      mapStatus.textContent = "Geolocation not available.";
      return;
    }
    mapStatus.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        latInput.value = lat;
        lngInput.value = lng;
        mapStatus.textContent = "Location captured.";
        if (map && window.google && google.maps) {
          placeMarker({ lat, lng });
        }
      },
      () => {
        mapStatus.textContent = "Could not read location.";
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      statusEl.textContent = "Set location on the map or use GPS.";
      statusEl.style.color = "#f87171";
      return;
    }

    statusEl.textContent = "Sending…";
    statusEl.style.color = "";
    const fd = new FormData(form);
    const payload = {
      latitude: lat,
      longitude: lng,
      brief_symptoms: fd.get("brief_symptoms"),
      address_hint: fd.get("address_hint") || "",
      patient_name: fd.get("patient_name") || "",
    };
    const pref = fd.get("preferred_hospital_id");
    if (pref) payload.preferred_hospital_id = pref;

    try {
      const res = await fetch("/api/emergency-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = data.error || "Error";
        statusEl.style.color = "#f87171";
        return;
      }
      statusEl.textContent = "Sent ✓";
      statusEl.style.color = "#86efac";
      const r = data.request;
      doneText.textContent =
        "Request #" + r.id + " created. Ambulance crews have been alerted.";
      donePanel.classList.remove("hidden");
      donePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      statusEl.textContent = "Network error";
      statusEl.style.color = "#f87171";
    }
  });
})();
