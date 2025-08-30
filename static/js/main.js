/* ======================================================
   Juego "Adivina la Canción" — FRONTEND ROBUSTO
   - Espera DOMContentLoaded
   - Valida existencias de IDs
   - Maneja errores de fetch con mensaje del backend
   - Fallbacks para habilitar botón de audio
====================================================== */

document.addEventListener("DOMContentLoaded", () => {
  /** Helper para obtener elementos por ID y avisar si faltan. */
  const $ = (id, optional = false) => {
    const el = document.getElementById(id);
    if (!el && !optional) console.error(`❌ Falta #${id} en el HTML`);
    return el;
  };

  // --------- Referencias del DOM (ajusta los IDs si hace falta) ----------
  const btnStartPlaylist  = $("start-with-playlist", true);
  const btnStartDefault   = $("start-default", true);
  const btnPlayFragment   = $("play-fragment");
  const btnGuess          = $("guess-btn");
  const btnNext           = $("reset-btn");
  const btnVolverPlaylist = $("btn-volver-playlist", true);
  const toggleDarkBtn     = $("toggle-dark", true);

  const audioEl         = $("audio-player");
  const hintText        = $("hint-text");
  const attemptsBox     = $("attempt-boxes");
  const attemptsRemain  = $("attempts-remaining");
  const resultMsg       = $("result-message");
  const historialEl     = $("historial");
  const guessInput      = $("guess-input");
  const autoList        = $("autocomplete-list", true); // puede faltar si no usás <datalist>
  const solvedListEl    = $("solved-songs");

  const screenSelect    = $("playlist-select-screen", true); // puede que tu landing no tenga esto
  const screenGame      = $("juego-main");
  const playlistInfo    = $("playlist-info", true);
  const playlistInput   = $("playlist-input", true);

  // Si hay IDs críticos ausentes, abortamos para que el error sea claro.
  const criticalMissing = [btnPlayFragment, btnGuess, btnNext, audioEl, hintText, attemptsBox, attemptsRemain, resultMsg, historialEl, guessInput, solvedListEl, screenGame].some(el => !el);
  if (criticalMissing) {
    console.error("🚫 No puedo iniciar la UI porque faltan elementos críticos en el DOM (ver errores arriba).");
    return;
  }

  // --------- Estado ----------
  const FRAGMENT_DURATIONS = [0.5, 1, 2, 4, 6];
  const MAX_INTENTS = 5;
  let currentAttempt = 0;
  let roundHistory = [];
  let canInteract = true;
  let audioTimeout = null;

  // Estado inicial
  btnPlayFragment.disabled = true;
  if (screenSelect) screenSelect.style.display = ""; // según tu HTML
  screenGame.style.display = "none";

  // --------- Listeners de inicio ----------
  if (btnStartPlaylist && playlistInput) {
    btnStartPlaylist.addEventListener("click", () => startGame(playlistInput.value.trim() || null));
  }
  if (btnStartDefault) {
    btnStartDefault.addEventListener("click", () => startGame(null));
  }

  // Volver (si existe)
  if (btnVolverPlaylist && screenSelect) {
    btnVolverPlaylist.addEventListener("click", () => {
      screenGame.style.display = "none";
      screenSelect.style.display = "flex";
      limpiarUI();
      fetch("/reset", { method: "POST" }).catch(() => {});
    });
  }

  // Toggle tema (si existe)
  if (toggleDarkBtn) {
    toggleDarkBtn.addEventListener("click", () => {
      const next = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.body.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
    // tema inicial
    const pref = localStorage.getItem("theme");
    if (pref) document.body.setAttribute("data-theme", pref);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches)
      document.body.setAttribute("data-theme", "dark");
    else document.body.setAttribute("data-theme", "light");
  }

  // --------- Core ---------

  function startGame(playlist_id, playlist_name = null) {
    // Deshabilito botones de landing si existen
    lockLanding(true);

    fetch("/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlist_id, playlist_name })
    })
      .then(ensureJSON)   // <- si viene 400, lanza con el mensaje del backend
      .then(data => {
        if (screenSelect) screenSelect.style.display = "none";
        screenGame.style.display = "block";
        if (playlistInfo) playlistInfo.textContent = data.playlist_name || "";
        actualizarHistorialGlobal();
        iniciarRonda();
      })
      .catch(err => {
        alert(`No se pudo iniciar el juego.\n${err.message || err}`);
        console.error(err);
      })
      .finally(() => lockLanding(false));
  }

  function lockLanding(lock) {
    if (btnStartPlaylist) btnStartPlaylist.disabled = lock;
    if (btnStartDefault)  btnStartDefault.disabled  = lock;
  }

  function iniciarRonda() {
    currentAttempt = 0;
    roundHistory = [];
    canInteract = true;
    clearAudio();

    setResult("");
    setHint("¡Escuchá el fragmento y adiviná la canción!");
    historialEl.innerHTML = "";
    btnNext.style.display = "none";
    guessInput.value = "";
    btnPlayFragment.disabled = true;
    btnGuess.disabled = false;

    actualizarIntentos();
    mostrarHistorial();
    cargarHint();
  }

  function cargarHint() {
    btnPlayFragment.disabled = true;
    fetch(`/hint?attempt=${currentAttempt + 1}`)
      .then(ensureJSON)
      .then(data => {
        if (data.error) {
          setHint(data.error);
          return;
        }
        if (data.pista && data.pista.trim() !== "") {
          setHint("💡 " + data.pista);
        } else {
          setHint("¡Escuchá el fragmento y adiviná la canción!");
        }

        actualizarAutocomplete(data.canciones_posibles || []);

        if (data.preview_url) {
          audioEl.src = data.preview_url;
          // Cargar y habilitar el botón con varios triggers (algunos navegadores no disparan todos)
          audioEl.load();
          const enable = () => { btnPlayFragment.disabled = false; cleanup(); };
          const cleanup = () => {
            audioEl.oncanplay = null;
            audioEl.onloadeddata = null;
            audioEl.onloadedmetadata = null;
          };
          audioEl.oncanplay = enable;
          audioEl.onloadeddata = enable;
          audioEl.onloadedmetadata = enable;
          // Fallback inmediato si ya está listo
          if (audioEl.readyState >= 2) btnPlayFragment.disabled = false;
        } else {
          // sin preview => no se puede reproducir
          btnPlayFragment.disabled = true;
        }
      })
      .catch(err => {
        console.error(err);
        setHint("No se pudo cargar la pista. Probá de nuevo.");
      });
  }

  btnPlayFragment.addEventListener("click", () => {
    if (!canInteract || currentAttempt >= MAX_INTENTS) return;
    if (!audioEl.src) { animarInputError(); return; }

    clearAudio();
    audioEl.currentTime = 0;
    audioEl.volume = 0.7;
    audioEl.play().catch(() => {
      // algunos navegadores piden interacción adicional
      alert("Tu navegador bloqueó la reproducción automática. Volvé a intentar.");
    });
    audioTimeout = window.setTimeout(() => {
      audioEl.pause();
      audioEl.currentTime = 0;
    }, (FRAGMENT_DURATIONS[currentAttempt] || 1) * 1000);
  });

  btnGuess.addEventListener("click", () => {
    if (!canInteract) return;
    const guess = (guessInput.value || "").trim();
    if (!guess) animarInputError();

    canInteract = true;
    btnGuess.disabled = true;

    fetch("/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guess })
    })
      .then(ensureJSON)
      .then(data => {
        canInteract = true;
        guessInput.value = "";
        roundHistory = data.jugadas || [];
        currentAttempt = roundHistory.length;

        if (data.correcto) {
          if (window.confetti) window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
          setResult("¡Correcto! Era: " + data.answer, true);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else if (data.answer) {
          setResult("Fin del juego. Era: " + data.answer, false);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else {
          animarInputError();
          setResult("Incorrecto", false);
          cargarHint();
          btnGuess.disabled = false;
        }

        actualizarIntentos();
        mostrarHistorial();
      })
      .catch(err => {
        canInteract = true;
        btnGuess.disabled = false;
        console.error(err);
        setResult(`Ocurrió un error. ${err.message || ""}`, false);
      });
  });

  btnNext.addEventListener("click", iniciarRonda);

  // --------- UI helpers ---------
  function actualizarIntentos() {
    attemptsBox.innerHTML = "";
    for (let i = 0; i < MAX_INTENTS; i++) {
      const estado = roundHistory[i]
        ? (roundHistory[i].correcta ? "correct" : "wrong")
        : "empty";
      const span = document.createElement("span");
      span.className = "attempt-square " + estado;
      attemptsBox.appendChild(span);
    }
    attemptsRemain.innerHTML = `<b>${Math.max(0, MAX_INTENTS - currentAttempt)}</b> intentos restantes`;
  }

  function setHint(msg) { hintText.innerHTML = msg || ""; }

  function setResult(msg, ok = null) {
    resultMsg.textContent = msg || "";
    resultMsg.classList.toggle("success", !!ok);
    resultMsg.style.color = ok === null ? "inherit" : (ok ? "var(--success)" : "var(--danger)");
    resultMsg.classList.add("show-result");
  }

  function mostrarHistorial() {
    if (!roundHistory.length) {
      historialEl.innerHTML = "";
      return;
    }
    historialEl.innerHTML =
      "<b>Jugadas ronda actual:</b><br>" +
      roundHistory.map((it, i) => {
        const emoji = it.correcta ? "✅" : "❌";
        return `<span class="${it.correcta ? 'correct' : 'wrong'}">${emoji} ${i + 1}: ${it.guess}</span>`;
      }).join("<br>");
  }

  function actualizarHistorialGlobal() {
    fetch("/historial-global")
      .then(ensureJSON)
      .then(historial => {
        solvedListEl.innerHTML = "";
        (historial || []).forEach(item => {
          const li = document.createElement("li");
          li.textContent = `${item.titulo} — ${item.artista}`;
          li.style.color = item.correcta ? "var(--success)" : "var(--danger)";
          solvedListEl.appendChild(li);
        });
      })
      .catch(err => console.error(err));
  }

  function actualizarAutocomplete(list) {
    if (!autoList) return; // si no usás datalist, salimos
    autoList.innerHTML = "";
    (list || []).forEach(c => {
      if (!c || c.includes("undefined")) return;
      const opt = document.createElement("option");
      opt.value = c;
      autoList.appendChild(opt);
    });
  }

  function playFullPreview(url) {
    if (!url) return;
    audioEl.src = url;
    audioEl.play().catch(() => {});
  }

  function clearAudio() {
    if (audioTimeout) window.clearTimeout(audioTimeout);
    audioTimeout = null;
    audioEl.pause();
    audioEl.currentTime = 0;
  }

  function animarInputError() {
    guessInput.classList.remove("wrong-guess");
    void guessInput.offsetWidth;
    guessInput.classList.add("wrong-guess");
    setTimeout(() => guessInput.classList.remove("wrong-guess"), 400);
  }

  function ensureJSON(resp) {
    if (!resp.ok) {
      return resp.json().then(j => {
        const msg = j && (j.error || j.message || JSON.stringify(j));
        throw new Error(`HTTP ${resp.status}${msg ? `: ${msg}` : ""}`);
      }).catch(() => { throw new Error(`HTTP ${resp.status}`); });
    }
    return resp.json();
  }

  // --------- Delegación para botones .playlist-btn (si existen) ---------
  document.querySelectorAll(".playlist-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const playlistId = btn.getAttribute("data-playlist-id");
      const playlistName = btn.textContent;
      startGame(playlistId || null, playlistName || null);
    });
  });
});