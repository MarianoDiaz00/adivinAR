document.addEventListener("DOMContentLoaded", () => {
  const FRAGMENT_DURATIONS = [0.5, 1, 2, 4, 6];
  const MAX_INTENTS = 5;
  const MAX_REFRESCOS = 2;         // renovaciones de audio por ronda (anti-bucle)

  let currentAttempt = 0;
  let roundHistory = [];
  let canInteract = true;
  let audioTimeout = null;

  // Control de versión de pista/hint para evitar carreras
  let hintReqSeq = 0;
  let currentPreviewUrl = null;

  // Estado de carga del audio
  let audioFallo = false;     // true si el preview no se pudo cargar
  let refrescosRonda = 0;     // cuántas veces renovamos el audio en esta ronda

  // Helper
  const $ = (id, optional = false) => {
    const el = document.getElementById(id);
    if (!el && !optional) console.error(`❌ Falta #${id} en el HTML`);
    return el;
  };

  // DOM
  const btnStartPlaylist  = $("start-with-playlist", true);
  const btnStartDefault   = $("start-default", true);
  const btnPlayFragment   = $("play-fragment");
  const btnGuess          = $("guess-btn");
  const btnNext           = $("reset-btn");
  const btnVolverPlaylist = $("btn-volver-playlist", true);
  const toggleDarkBtn     = $("toggle-dark", true);

  const audioEl        = $("audio-player");
  const hintText       = $("hint-text");
  const attemptsBox    = $("attempt-boxes");
  const attemptsRemain = $("attempts-remaining");
  const resultMsg      = $("result-message");
  const historialEl    = $("historial");
  const guessInput     = $("guess-input");
  const scoreEl        = $("score", true);
  const solvedListEl   = $("solved-songs", true);

  const screenSelect   = $("playlist-select-screen", true);
  const screenGame     = $("juego-main");
  const playlistInfo   = $("playlist-info", true);
  const playlistInput  = $("playlist-input", true);

  const predefButtons  = document.getElementById("predef-buttons");

  // Carga de playlists (una sola vez)
  if (predefButtons) {
    fetch("/api/playlists")
      .then(r => r.json())
      .then(list => {
        predefButtons.innerHTML = "";
        (list || []).forEach(pl => {
          const btn = document.createElement("button");
          btn.className = "btn playlist-btn";
          btn.textContent = pl.nombre;
          btn.dataset.playlistId = pl.id;
          btn.addEventListener("click", () => startGame(pl.id, pl.nombre));
          predefButtons.appendChild(btn);
        });
      })
      .catch(err => {
        console.error("No se pudieron cargar las playlists:", err);
        predefButtons.innerHTML =
          "<p style='color:var(--ink-muted)'>No se pudieron cargar las playlists.</p>";
      });
  }

  // Chequeo mínimo
  const criticalMissing = [
    btnPlayFragment, btnGuess, btnNext, audioEl, hintText, attemptsBox,
    attemptsRemain, resultMsg, historialEl, guessInput, screenGame
  ].some(el => !el);
  if (criticalMissing) {
    console.error("🚫 Faltan elementos críticos en el DOM.");
    return;
  }

  // Estado inicial
  btnPlayFragment.disabled = true;
  if (screenSelect) screenSelect.style.display = "";
  screenGame.style.display = "none";

  // Landing
  if (btnStartPlaylist && playlistInput) {
    btnStartPlaylist.addEventListener("click", () =>
      startGame((playlistInput.value || "").trim() || null)
    );
  }
  if (btnStartDefault) {
    btnStartDefault.addEventListener("click", () => startGame(null));
  }

  // Volver
  if (btnVolverPlaylist && screenSelect) {
    btnVolverPlaylist.addEventListener("click", () => {
      screenGame.style.display = "none";
      screenSelect.style.display = "flex";
      limpiarUI();
      fetch("/reset", { method: "POST" }).catch(() => {});
    });
  }

  // Tema
  if (toggleDarkBtn) {
    toggleDarkBtn.addEventListener("click", () => {
      const next = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.body.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch {}
    });
    try {
      const pref = localStorage.getItem("theme");
      if (pref) document.body.setAttribute("data-theme", pref);
      else if (matchMedia && matchMedia("(prefers-color-scheme: dark)").matches)
        document.body.setAttribute("data-theme", "dark");
      else document.body.setAttribute("data-theme", "light");
    } catch {}
  }

  // Core
  function startGame(playlist_id, playlist_name = null) {
    lockLanding(true);

    fetch("/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlist_id, playlist_name })
    })
      .then(ensureJSON)
      .then(data => {
        if (screenSelect) screenSelect.style.display = "none";
        screenGame.style.display = "block";
        if (playlistInfo) playlistInfo.textContent = data.playlist_name || "";
        setScore(data.puntaje || 0);
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
    if (predefButtons)    predefButtons.querySelectorAll("button").forEach(b => b.disabled = lock);
  }

  function iniciarRonda() {
    currentAttempt = 0;
    roundHistory = [];
    canInteract = true;
    refrescosRonda = 0;
    clearAudio(true); // reset duro: sin src

    setResult("");
    setHint("¡Escuchá el fragmento y adiviná la canción!");
    historialEl.innerHTML = "";
    btnNext.style.display = "none";
    guessInput.value = "";

    btnGuess.disabled = false;

    actualizarIntentos();
    mostrarHistorial();
    cargarHint();
  }

  // --- Manejo de audio ---
  function limpiarHandlersAudio() {
    audioEl.oncanplay = null;
    audioEl.onloadeddata = null;
    audioEl.onloadedmetadata = null;
    audioEl.onerror = null;
  }

  /**
   * Se llama SOLO ante un fallo real de audio (link vencido, media rota).
   * Intenta renovar el preview una vez; si vuelve a fallar, deja el botón
   * como "reintentar" para que el juego nunca quede trabado.
   */
  function manejarAudioRoto(yaSeRefresco) {
    limpiarHandlersAudio();
    if (!yaSeRefresco && refrescosRonda < MAX_REFRESCOS) {
      refrescosRonda++;
      setHint("🔄 Renovando el audio…");
      cargarHint(true);
    } else {
      setHint("No se pudo cargar el audio. Tocá 🔄 para reintentar.");
      marcarBotonReintentar(true);
    }
  }

  function marcarBotonReintentar(activo) {
    audioFallo = activo;
    btnPlayFragment.disabled = false; // NUNCA lo dejamos muerto
    btnPlayFragment.textContent = activo
      ? "🔄 Reintentar audio"
      : "🔊 Escuchar Fragmento";
  }

  /**
   * Pide la pista y prepara el audio.
   * @param {boolean} refrescar - si true, le pide al backend links de preview nuevos
   *                              (los de Deezer vencen tras un rato de juego).
   */
  function cargarHint(refrescar = false) {
    const req = ++hintReqSeq;
    currentPreviewUrl = null;
    audioFallo = false;
    btnPlayFragment.disabled = true;
    btnPlayFragment.textContent = "🔊 Escuchar Fragmento";
    clearAudio(true);

    const safeAttempt = Number.isFinite(currentAttempt) ? currentAttempt : 0;
    const url = `/hint?attempt=${safeAttempt + 1}${refrescar ? "&refresh=1" : ""}`;

    fetch(url)
      .then(ensureJSON)
      .then(data => {
        if (req !== hintReqSeq) return; // llegó tarde, ignoramos

        if (data.error) { setHint(data.error); marcarBotonReintentar(true); return; }

        if (data.pista && data.pista.trim() !== "") {
          setHint("💡 " + data.pista);
        } else if (!refrescar) {
          setHint("¡Escuchá el fragmento y adiviná la canción!");
        }

        if (!data.preview_url) {
          marcarBotonReintentar(true);
          setHint("No hay audio para esta canción. Tocá 🔄 o pasá de tema.");
          return;
        }

        currentPreviewUrl = data.preview_url;
        audioEl.src = currentPreviewUrl;
        audioEl.load();

        // Habilitamos el botón APENAS tenemos URL. No esperamos 'canplay':
        // muchos navegadores (sobre todo en celular) no cargan nada hasta que
        // el usuario toca, y esperar ese evento dejaba el botón muerto.
        audioFallo = false;
        btnPlayFragment.disabled = false;
        btnPlayFragment.textContent = "🔊 Escuchar Fragmento";

        // Único fallo que damos por real en la carga: un MediaError concreto
        // sobre el preview que estamos usando ahora.
        audioEl.onerror = () => {
          if (req !== hintReqSeq) return;
          if (!audioEl.error) return;                 // error sin causa: ignorar
          if (!audioEl.src || !currentPreviewUrl) return;
          if (!audioEl.src.includes(currentPreviewUrl)) return;  // no es el actual
          manejarAudioRoto(refrescar);
        };
      })
      .catch(err => {
        console.error(err);
        setHint("No se pudo cargar la pista. Tocá 🔄 para reintentar.");
        marcarBotonReintentar(true);
      });
  }

  btnPlayFragment.addEventListener("click", () => {
    // Si el audio venía fallado, el botón funciona como "reintentar".
    if (audioFallo) {
      cargarHint(true);
      return;
    }
    if (!canInteract || currentAttempt >= MAX_INTENTS) return;
    if (!currentPreviewUrl || !audioEl.src.includes(currentPreviewUrl)) {
      setHint("Preparando fragmento…");
      cargarHint();
      return;
    }

    if (audioTimeout) { clearTimeout(audioTimeout); audioTimeout = null; }
    try { audioEl.currentTime = 0; } catch {}
    audioEl.volume = 0.7;

    const duracion = (FRAGMENT_DURATIONS[currentAttempt] || 1) * 1000;

    audioEl.play().then(() => {
      // El cronómetro arranca cuando el audio EMPIEZA A SONAR de verdad,
      // no cuando pedimos reproducir: si tardaba en cargar, antes se comía
      // el fragmento en silencio.
      audioTimeout = setTimeout(() => {
        try { audioEl.pause(); audioEl.currentTime = 0; } catch {}
      }, duracion);
    }).catch(err => {
      const tipo = err && err.name;
      // Errores BENIGNOS: no son un audio roto, no hay que "reparar" nada.
      //  - NotAllowedError: el navegador pide un toque del usuario (autoplay).
      //  - AbortError: se pisaron dos play/pause seguidos.
      if (tipo === "NotAllowedError" || tipo === "AbortError") {
        setHint("🔊 Tocá el botón otra vez para escuchar el fragmento.");
        return;
      }
      // Cualquier otro: el preview probablemente venció.
      console.warn("Fallo real de reproducción:", tipo, err);
      manejarAudioRoto(false);
    });
  });

  // Adivinar (permite envíos vacíos; el "parcial" lo decide el servidor)
  btnGuess.addEventListener("click", () => {
    if (!canInteract) return;

    const guess = (guessInput.value ?? "");
    canInteract = false;
    btnGuess.disabled = true;

    fetch("/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guess })
    })
      .then(ensureJSON)
      .then(data => {
        // El servidor es la fuente de verdad: cada jugada trae correcta y parcial.
        roundHistory = data.jugadas || [];
        currentAttempt = roundHistory.length;

        guessInput.value = "";
        setScore(data.puntaje);

        if (data.correcto) {
          if (currentAttempt === 1 && window.confetti) {
            window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
          }
          setResult("¡Correcto! Era: " + data.answer + puntosTxt(data.puntos_ronda), true);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else if (data.answer) {
          setResult("Fin del juego. Era: " + data.answer + puntosTxt(data.puntos_ronda), false);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else {
          setResult(data.parcial ? "🟡 ¡Casi! Acertaste el artista" : "Incorrecto", false);
          cargarHint();
          btnGuess.disabled = false;
        }

        actualizarIntentos();
        mostrarHistorial();
      })
      .catch(err => {
        console.error(err);
        setResult(`Ocurrió un error. ${err.message || ""}`, false);
        btnGuess.disabled = false;
      })
      .finally(() => {
        canInteract = true;
      });
  });

  // Permitir Enter incluso vacío
  guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnGuess.click();
  });

  btnNext.addEventListener("click", iniciarRonda);

  // Helpers UI
  function puntosTxt(p) {
    if (typeof p !== "number") return "";
    return ` (+${p} ${p === 1 ? "punto" : "puntos"})`;
  }

  function setScore(n) {
    if (scoreEl) scoreEl.textContent = `Puntaje: ${n || 0}`;
  }

  function actualizarIntentos() {
    attemptsBox.innerHTML = "";
    for (let i = 0; i < MAX_INTENTS; i++) {
      const j = roundHistory[i];
      const estado = j
        ? (j.correcta ? "correct" : (j.parcial ? "partial" : "wrong"))
        : "empty";
      const span = document.createElement("span");
      span.className = "attempt-square " + estado;
      attemptsBox.appendChild(span);
    }
    attemptsRemain.innerHTML =
      `<b>${Math.max(0, MAX_INTENTS - currentAttempt)}</b> intentos restantes`;
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
        let emoji, clase;
        if (it.correcta) { emoji = "✅"; clase = "correct"; }
        else if (it.parcial) { emoji = "🟡"; clase = "partial"; }
        else { emoji = "❌"; clase = "wrong"; }
        return `<span class="${clase}">${emoji} ${i + 1}: ${it.guess || "(vacío)"}</span>`;
      }).join("<br>");
  }

  function actualizarHistorialGlobal() {
    const wrongEl   = document.getElementById("solved-wrong");
    const correctEl = document.getElementById("solved-correct");
    const singleEl  = solvedListEl || null;

    fetch("/historial-global")
      .then(ensureJSON)
      .then(historial => {
        if (wrongEl)   wrongEl.innerHTML = "";
        if (correctEl) correctEl.innerHTML = "";
        if (singleEl)  singleEl.innerHTML = "";

        (historial || []).forEach(item => {
          const li = document.createElement("li");
          li.textContent = `${item.titulo} — ${item.artista}`;
          if (item.correcta) {
            if (correctEl) correctEl.appendChild(li);
            else if (singleEl) { li.style.color = "var(--success)"; singleEl.appendChild(li); }
          } else {
            if (wrongEl) wrongEl.appendChild(li);
            else if (singleEl) { li.style.color = "var(--danger)"; singleEl.appendChild(li); }
          }
        });
      })
      .catch(err => console.error("Error actualizando historial:", err));
  }

  function playFullPreview(url) {
    if (!url) return;
    audioEl.src = url;
    audioEl.play().catch(() => {});
  }

  function clearAudio(resetSrc = false) {
    if (audioTimeout) clearTimeout(audioTimeout);
    audioTimeout = null;
    if (resetSrc) limpiarHandlersAudio();
    try { audioEl.pause(); } catch {}
    try { if (audioEl.currentTime) audioEl.currentTime = 0; } catch {}
    if (resetSrc) {
      // OJO: removeAttribute("src") + load() hace que el navegador emita un
      // evento 'error' espurio ("Empty src"). Por eso limpiamos los handlers
      // ANTES (arriba) y NO llamamos a load() con el src vacío.
      try { audioEl.removeAttribute("src"); } catch {}
    }
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

  // Delegación defensiva por si JS crea botones luego
  document.addEventListener("click", e => {
    const btn = e.target.closest(".playlist-btn");
    if (!btn) return;
    const playlistId = btn.getAttribute("data-playlist-id");
    const playlistName = btn.textContent;
    startGame(playlistId || null, playlistName || null);
  });

  function limpiarUI() {
    setResult("");
    setHint("");
    historialEl.innerHTML = "";
    attemptsBox.innerHTML = "";
    attemptsRemain.textContent = "";
    setScore(0);
    clearAudio(true);
  }
});
          btnPlayFragment.textContent = "🔊 Escuchar Fragmento";
        };

        const fallo = () => {
          if (req !== hintReqSeq) return;
          limpiarHandlersAudio();
          if (!refrescar) {
            // Muy probablemente venció el link del preview: pedimos uno nuevo.
            setHint("🔄 Renovando el audio…");
            cargarHint(true);
          } else {
            // Ya reintentamos con links frescos y sigue fallando.
            setHint("No se pudo cargar el audio. Tocá 🔄 para reintentar.");
            marcarBotonReintentar(true);
          }
        };

        audioEl.oncanplay = listo;
        audioEl.onloadeddata = listo;
        audioEl.onloadedmetadata = listo;
        audioEl.onerror = fallo;
        // Red 
        audioWatchdog = setTimeout(fallo, AUDIO_TIMEOUT_MS);
      })
      .catch(err => {
        console.error(err);
        setHint("No se pudo cargar la pista. Tocá 🔄 para reintentar.");
        marcarBotonReintentar(true);
      });
  }

  btnPlayFragment.addEventListener("click", () => {
    // Si el audio venía fallado, el botón funciona como "reintentar".
    if (audioFallo) {
      cargarHint(true);
      return;
    }
    if (!canInteract || currentAttempt >= MAX_INTENTS) return;
    if (!currentPreviewUrl || !audioEl.src.includes(currentPreviewUrl)) {
      setHint("Preparando fragmento…");
      cargarHint();
      return;
    }

    clearAudio(); // pausa/limpia timers, mantiene src actual
    audioEl.currentTime = 0;
    audioEl.volume = 0.7;
    audioEl.play().catch(() => {
      // Puede ser bloqueo de autoplay o un link vencido: ofrecemos reintentar.
      setHint("No se pudo reproducir. Tocá 🔄 para reintentar.");
      marcarBotonReintentar(true);
    });
    audioTimeout = setTimeout(() => {
      audioEl.pause();
      audioEl.currentTime = 0;
    }, (FRAGMENT_DURATIONS[currentAttempt] || 1) * 1000);
  });

  // Adivinar (permite envíos vacíos; el "parcial" lo decide el servidor)
  btnGuess.addEventListener("click", () => {
    if (!canInteract) return;

    const guess = (guessInput.value ?? "");
    canInteract = false;
    btnGuess.disabled = true;

    fetch("/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guess })
    })
      .then(ensureJSON)
      .then(data => {
        // El servidor es la fuente de verdad: cada jugada trae correcta y parcial.
        roundHistory = data.jugadas || [];
        currentAttempt = roundHistory.length;

        guessInput.value = "";
        setScore(data.puntaje);

        if (data.correcto) {
          if (currentAttempt === 1 && window.confetti) {
            window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
          }
          setResult("¡Correcto! Era: " + data.answer + puntosTxt(data.puntos_ronda), true);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else if (data.answer) {
          setResult("Fin del juego. Era: " + data.answer + puntosTxt(data.puntos_ronda), false);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else {
          setResult(data.parcial ? "🟡 ¡Casi! Acertaste el artista" : "Incorrecto", false);
          cargarHint();
          btnGuess.disabled = false;
        }

        actualizarIntentos();
        mostrarHistorial();
      })
      .catch(err => {
        console.error(err);
        setResult(`Ocurrió un error. ${err.message || ""}`, false);
        btnGuess.disabled = false;
      })
      .finally(() => {
        canInteract = true;
      });
  });

  // Permitir Enter incluso vacío
  guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnGuess.click();
  });

  btnNext.addEventListener("click", iniciarRonda);

  // Helpers UI
  function puntosTxt(p) {
    if (typeof p !== "number") return "";
    return ` (+${p} ${p === 1 ? "punto" : "puntos"})`;
  }

  function setScore(n) {
    if (scoreEl) scoreEl.textContent = `Puntaje: ${n || 0}`;
  }

  function actualizarIntentos() {
    attemptsBox.innerHTML = "";
    for (let i = 0; i < MAX_INTENTS; i++) {
      const j = roundHistory[i];
      const estado = j
        ? (j.correcta ? "correct" : (j.parcial ? "partial" : "wrong"))
        : "empty";
      const span = document.createElement("span");
      span.className = "attempt-square " + estado;
      attemptsBox.appendChild(span);
    }
    attemptsRemain.innerHTML =
      `<b>${Math.max(0, MAX_INTENTS - currentAttempt)}</b> intentos restantes`;
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
        let emoji, clase;
        if (it.correcta) { emoji = "✅"; clase = "correct"; }
        else if (it.parcial) { emoji = "🟡"; clase = "partial"; }
        else { emoji = "❌"; clase = "wrong"; }
        return `<span class="${clase}">${emoji} ${i + 1}: ${it.guess || "(vacío)"}</span>`;
      }).join("<br>");
  }

  function actualizarHistorialGlobal() {
    const wrongEl   = document.getElementById("solved-wrong");
    const correctEl = document.getElementById("solved-correct");
    const singleEl  = solvedListEl || null;

    fetch("/historial-global")
      .then(ensureJSON)
      .then(historial => {
        if (wrongEl)   wrongEl.innerHTML = "";
        if (correctEl) correctEl.innerHTML = "";
        if (singleEl)  singleEl.innerHTML = "";

        (historial || []).forEach(item => {
          const li = document.createElement("li");
          li.textContent = `${item.titulo} — ${item.artista}`;
          if (item.correcta) {
            if (correctEl) correctEl.appendChild(li);
            else if (singleEl) { li.style.color = "var(--success)"; singleEl.appendChild(li); }
          } else {
            if (wrongEl) wrongEl.appendChild(li);
            else if (singleEl) { li.style.color = "var(--danger)"; singleEl.appendChild(li); }
          }
        });
      })
      .catch(err => console.error("Error actualizando historial:", err));
  }

  function playFullPreview(url) {
    if (!url) return;
    audioEl.src = url;
    audioEl.play().catch(() => {});
  }

  function clearAudio(resetSrc = false) {
    if (audioTimeout) clearTimeout(audioTimeout);
    audioTimeout = null;
    if (resetSrc) limpiarHandlersAudio();
    try { audioEl.pause(); } catch {}
    try { audioEl.currentTime = 0; } catch {}
    if (resetSrc) {
      try { audioEl.removeAttribute("src"); } catch {}
      try { audioEl.load(); } catch {}
    }
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

  // Delegación defensiva por si JS crea botones luego
  document.addEventListener("click", e => {
    const btn = e.target.closest(".playlist-btn");
    if (!btn) return;
    const playlistId = btn.getAttribute("data-playlist-id");
    const playlistName = btn.textContent;
    startGame(playlistId || null, playlistName || null);
  });

  function limpiarUI() {
    setResult("");
    setHint("");
    historialEl.innerHTML = "";
    attemptsBox.innerHTML = "";
    attemptsRemain.textContent = "";
    setScore(0);
    clearAudio(true);
  }
});
