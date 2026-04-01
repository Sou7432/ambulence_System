(function () {
  const boot = document.getElementById("ambusync-boot");
  const mapsKey = boot?.dataset?.mapsKey;
  if (mapsKey) {
    window.AMBUSYNC_MAPS_KEY = mapsKey;
  }

  const ambulanceSelect = document.getElementById("ambulance-select");
  const crewType = document.getElementById("crew-type");
  const crewStatus = document.getElementById("crew-status");
  const queueEl = document.getElementById("request-queue");
  const queueEmpty = document.getElementById("queue-empty");
  const triageForm = document.getElementById("triage-form");
  const triageLockMsg = document.getElementById("triage-lock-msg");
  const fieldRequestId = document.getElementById("field-request-id");
  const fieldAmbulanceId = document.getElementById("field-ambulance-id");
  const form = triageForm;
  const statusEl = document.getElementById("submit-status");
  const voiceBtn = document.getElementById("btn-voice");
  const voiceStatus = document.getElementById("voice-status");
  const mapStatus = document.getElementById("map-status");
  const locateBtn = document.getElementById("btn-locate");
  const latInput = document.getElementById("latitude");
  const lngInput = document.getElementById("longitude");
  const resultPanel = document.getElementById("result-panel");
  const resultSummary = document.getElementById("result-summary");
  const resultUrgency = document.getElementById("result-urgency");
  const resultHospital = document.getElementById("result-hospital");
  const hospitalSelect = document.getElementById("crew-preferred-hospital");
  const btnSubmit = document.getElementById("btn-submit");

  let map = null;
  let marker = null;
  const pendingById = new Map();

  function setTriageLocked(locked) {
    triageForm.classList.toggle("is-locked", locked);
    triageLockMsg.classList.toggle("hidden", !locked);
    const controls = triageForm.querySelectorAll(
      "input, select, textarea, #btn-voice, #btn-locate, #btn-submit"
    );
    controls.forEach((el) => {
      if (el.id === "field-request-id" || el.id === "field-ambulance-id") return;
      el.disabled = locked;
    });
  }

  function selectedAmbulanceId() {
    return (ambulanceSelect.value || "").trim();
  }

  function syncCrewMeta() {
    const opt = ambulanceSelect.selectedOptions[0];
    if (!opt || !opt.dataset.type) {
      crewType.textContent = "—";
      crewStatus.textContent = "—";
      return;
    }
    crewType.textContent = opt.dataset.type || "—";
    crewStatus.textContent = opt.dataset.status || "—";
  }

  async function loadAmbulances() {
    const res = await fetch("/api/ambulances");
    const data = await res.json();
    const current = selectedAmbulanceId();
    ambulanceSelect.innerHTML = '<option value="">Select unit…</option>';
    for (const a of data.ambulances || []) {
      const o = document.createElement("option");
      o.value = a.ambulance_id;
      o.textContent = a.ambulance_id + " (" + a.ambulance_type + ")";
      o.dataset.type = a.ambulance_type;
      o.dataset.status = a.status;
      ambulanceSelect.appendChild(o);
    }
    if (current) {
      ambulanceSelect.value = current;
    }
    syncCrewMeta();
  }

  async function loadHospitals() {
    const res = await fetch("/api/hospitals");
    const data = await res.json();
    hospitalSelect.innerHTML =
      '<option value="">Use patient auto-selection</option>';
    for (const h of data.hospitals || []) {
      const o = document.createElement("option");
      o.value = h.id;
      o.textContent = h.name;
      hospitalSelect.appendChild(o);
    }
  }

  function renderQueue() {
    const items = Array.from(pendingById.values()).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    queueEl.innerHTML = "";
    queueEmpty.classList.toggle("hidden", items.length > 0);
    const ambId = selectedAmbulanceId();
    for (const r of items) {
      const card = document.createElement("article");
      card.className = "request-card";
      card.innerHTML =
        "<header><strong>Request #" +
        r.id +
        "</strong> <span class='req-time'></span></header>" +
        "<p class='req-sym'></p>" +
        "<p class='req-meta'></p>" +
        "<button type='button' class='btn btn-primary btn-accept'>Accept</button>";
      card.querySelector(".req-time").textContent = formatTime(r.created_at);
      card.querySelector(".req-sym").textContent = r.brief_symptoms || "";
      const meta = [];
      if (r.patient_name) meta.push("Patient note: " + r.patient_name);
      if (r.address_hint) meta.push(r.address_hint);
      meta.push(
        "GPS: " + r.latitude.toFixed(4) + ", " + r.longitude.toFixed(4)
      );
      card.querySelector(".req-meta").textContent = meta.join(" · ");
      const btn = card.querySelector(".btn-accept");
      btn.dataset.requestId = String(r.id);
      btn.disabled = !ambId;
      btn.addEventListener("click", () => acceptRequest(r.id));
      queueEl.appendChild(card);
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function setUrgencyClass(el, urgency) {
    el.className = "urgency-pill";
    const u = (urgency || "").toLowerCase();
    if (u === "critical") el.classList.add("critical");
    else if (u === "moderate") el.classList.add("moderate");
    else el.classList.add("stable");
  }

  function showResult(summary, urgency, hospitalLine) {
    resultSummary.textContent = summary;
    resultUrgency.textContent = "Urgency: " + urgency;
    setUrgencyClass(resultUrgency, urgency);
    resultHospital.textContent = hospitalLine || "";
    resultPanel.classList.remove("hidden");
    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function acceptRequest(requestId) {
    const ambId = selectedAmbulanceId();
    if (!ambId) {
      alert("Select your ambulance unit first.");
      return;
    }
    try {
      const res = await fetch(
        "/api/emergency-requests/" + requestId + "/accept",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ambulance_id: ambId }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Could not accept");
        return;
      }
      pendingById.delete(requestId);
      renderQueue();
      const req = data.request;
      fieldRequestId.value = String(req.id);
      fieldAmbulanceId.value = ambId;
      form.querySelector('[name="symptoms"]').value = req.brief_symptoms || "";
      form.querySelector('[name="patient_name"]').value =
        req.patient_name || "";
      hospitalSelect.value = req.preferred_hospital_id || "";
      setTriageLocked(false);
      await loadAmbulances();
    } catch {
      alert("Network error");
    }
  }

  ambulanceSelect.addEventListener("change", () => {
    syncCrewMeta();
    renderQueue();
  });

  const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    socket.emit("join_ambulance");
  });

  socket.on("requests_snapshot", (data) => {
    pendingById.clear();
    for (const r of data.requests || []) {
      if (r.status === "pending") pendingById.set(r.id, r);
    }
    renderQueue();
  });

  socket.on("new_emergency_request", (r) => {
    if (r && r.status === "pending") pendingById.set(r.id, r);
    renderQueue();
  });

  socket.on("ambulance_assigned", () => {
    loadAmbulances();
    fetch("/api/emergency-requests?status=pending")
      .then((res) => res.json())
      .then((data) => {
      pendingById.clear();
      for (const r of data.requests || []) pendingById.set(r.id, r);
      renderQueue();
    });
  });

  socket.on("ambulances_snapshot", () => {
    loadAmbulances();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (fieldRequestId.value === "") {
      statusEl.textContent = "Accept a request first.";
      return;
    }
    statusEl.textContent = "Submitting…";
    statusEl.style.color = "";
    const fd = new FormData(form);
    const payload = {
      request_id: parseInt(fd.get("request_id"), 10),
      ambulance_id: fd.get("ambulance_id"),
      patient_name: fd.get("patient_name"),
      age: parseInt(fd.get("age"), 10),
      sex: fd.get("sex") || "",
      symptoms: fd.get("symptoms"),
      bp_systolic: parseInt(fd.get("bp_systolic"), 10),
      bp_diastolic: parseInt(fd.get("bp_diastolic"), 10),
      pulse: parseInt(fd.get("pulse"), 10),
      spo2: parseInt(fd.get("spo2"), 10),
      consciousness: fd.get("consciousness"),
      address_hint: fd.get("address_hint") || "",
    };
    const pref = fd.get("preferred_hospital_id");
    if (pref) payload.preferred_hospital_id = pref;
    const la = fd.get("latitude");
    const ln = fd.get("longitude");
    if (la && ln) {
      payload.latitude = parseFloat(la);
      payload.longitude = parseFloat(ln);
    }
    try {
      const res = await fetch("/api/triage-submit", {
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
      statusEl.textContent = "Hospital notified ✓";
      statusEl.style.color = "#86efac";
      const c = data.case;
      const h = data.hospital;
      const line = h
        ? "Routed to: " + h.name + (h.distance_km != null ? " (~" + h.distance_km + " km)" : "")
        : "";
      showResult(c.summary, c.urgency, line);
      form.reset();
      fieldRequestId.value = "";
      fieldAmbulanceId.value = "";
      setTriageLocked(true);
      await loadAmbulances();
    } catch {
      statusEl.textContent = "Network error";
      statusEl.style.color = "#f87171";
    }
  });

  voiceBtn.addEventListener("click", () => {
    if (voiceBtn.disabled) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceStatus.textContent = "Speech recognition not supported.";
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    voiceStatus.textContent = "Listening…";
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      const ta = form.querySelector('[name="symptoms"]');
      ta.value = (ta.value ? ta.value.trim() + " " : "") + text;
      voiceStatus.textContent = "Captured.";
    };
    rec.onerror = () => {
      voiceStatus.textContent = "Speech error.";
    };
    rec.onend = () => {
      if (voiceStatus.textContent === "Listening…") voiceStatus.textContent = "";
    };
    rec.start();
  });

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

  window.ambusyncInitMap = function () {
    const el = document.getElementById("map");
    if (!el || !window.google) return;
    map = new google.maps.Map(el, {
      center: { lat: 22.5726, lng: 88.3639 },
      zoom: 11,
    });
    mapStatus.textContent =
      "Optional: set scene location on map or use GPS.";
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
        "Add <code>GOOGLE_MAPS_API_KEY</code> for map, or use GPS on unlock.";
    }
  }

  locateBtn.addEventListener("click", () => {
    if (locateBtn.disabled) return;
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
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });

  setTriageLocked(true);
  loadAmbulances();
  loadHospitals();
})();
