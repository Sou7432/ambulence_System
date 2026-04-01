(function () {
  const listEl = document.getElementById("case-list");
  const emptyMsg = document.getElementById("empty-msg");
  const tpl = document.getElementById("card-template");
  const connStatus = document.getElementById("conn-status");

  function urgencyToClass(u) {
    const x = (u || "").toLowerCase();
    if (x === "critical") return "urgency-critical";
    if (x === "moderate") return "urgency-moderate";
    return "urgency-stable";
  }

  function badgeClass(u) {
    const x = (u || "").toLowerCase();
    if (x === "critical") return "badge-critical";
    if (x === "moderate") return "badge-moderate";
    return "badge-stable";
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return iso;
    }
  }

  function fillCard(node, c) {
    node.querySelector(".case-name").textContent =
      c.patient_name + (c.age != null ? " · " + c.age + " y" : "");
    node.querySelector(".case-time").textContent = formatTime(c.created_at);
    node.querySelector(".case-summary").textContent = c.summary || "";
    const routing = node.querySelector(".case-routing");
    const reason = c.hospital_selection_reason || "";
    routing.textContent = reason ? "Routing: " + reason : "";
    routing.style.display = reason ? "block" : "none";

    const urg = node.querySelector(".case-urgency");
    urg.textContent = c.urgency || "—";
    urg.className = "case-urgency " + badgeClass(c.urgency);
    node.className = "case-card " + urgencyToClass(c.urgency);

    node.querySelector(".v-req").textContent = c.request_id != null ? "#" + c.request_id : "—";
    node.querySelector(".v-amb").textContent = c.ambulance_id || "—";
    node.querySelector(".v-hosp").textContent = c.hospital_name || "—";

    node.querySelector(".v-age").textContent = c.age != null ? String(c.age) : "—";
    node.querySelector(".v-bp").textContent =
      c.bp_systolic != null && c.bp_diastolic != null
        ? c.bp_systolic + "/" + c.bp_diastolic + " mmHg"
        : "—";
    node.querySelector(".v-pulse").textContent =
      c.pulse != null ? c.pulse + " bpm" : "—";
    node.querySelector(".v-spo2").textContent =
      c.spo2 != null ? c.spo2 + "%" : "—";
    node.querySelector(".v-con").textContent = c.consciousness || "—";
    node.querySelector(".v-sym").textContent = c.symptoms || "—";

    const loc = node.querySelector(".case-loc");
    const link = loc.querySelector(".map-link");
    if (c.latitude != null && c.longitude != null) {
      loc.classList.remove("hidden");
      const url =
        "https://www.google.com/maps?q=" +
        encodeURIComponent(c.latitude + "," + c.longitude);
      link.href = url;
    } else {
      loc.classList.add("hidden");
    }
  }

  function prependCase(c) {
    const frag = tpl.content.cloneNode(true);
    const card = frag.querySelector(".case-card");
    fillCard(card, c);
    listEl.prepend(frag);
    emptyMsg.classList.add("hidden");
  }

  function renderSnapshot(cases) {
    listEl.innerHTML = "";
    if (!cases || !cases.length) {
      emptyMsg.classList.remove("hidden");
      return;
    }
    emptyMsg.classList.add("hidden");
    cases.forEach((c) => {
      const card = tpl.content.cloneNode(true).querySelector(".case-card");
      fillCard(card, c);
      listEl.appendChild(card);
    });
  }

  const socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    connStatus.textContent = "Live";
    socket.emit("join_hospital");
  });

  socket.on("disconnect", () => {
    connStatus.textContent = "Disconnected";
  });

  socket.on("cases_snapshot", (data) => {
    renderSnapshot(data.cases || []);
  });

  socket.on("hospital_notified", (data) => {
    if (data && data.case) {
      prependCase(data.case);
    }
  });
})();
