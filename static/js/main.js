document.addEventListener("DOMContentLoaded", () => {
  // --- Estado (primero, para evitar TDZ) ---
  const FRAGMENT_DURATIONS = [0.5, 1, 2, 4, 6];
  const MAX_INTENTS = 5;
  let currentAttempt = 0;
  let roundHistory = [];
  let canInteract = true;
  let audioTimeout = null;

  // Control de versión de pista/hint para evitar carreras
  let hintReqSeq = 0;
  let currentPreviewUrl = null;

  // Artista y candidatos para detectar "parcial"
  let currentArtist = null;            // artista principal de la ronda
  let candidateArtists = new Set();    // artistas derivados de canciones_posibles

  // Cache de parciales por intento (clave = guess normalizado)
  let partialByGuess = new Map();

  // Helper
  const $ = (id, optional = false) => {
    const el = document.getElementById(id);
    if (!el && !optional) console.error(`❌ Falta #${id} en el HTML`);
    return el;
  };

  // ─── Helpers de normalización / artista / parcial ──────────────────────────
  const normalize = s => (s || "")
    .toString()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // Soporta -, – y — como separador entre título y artista
  function splitTitleArtist(str){
    if (!str) return [String(str), null];
    const s = String(str);
    const m = s.match(/^(.*?)[\s]*[-–—][\s]*(.+)$/);
    if (m) return [m[1].trim(), m[2].trim()];
    return [s, null];
  }

  const extractArtistFromAnswer = ans => {
    const [, artist] = splitTitleArtist(ans);
    return artist || null;
  };

  const extractArtistFromGuess = g => {
    const [, artist] = splitTitleArtist(g || "");
    return artist || "";
  };

  const artistMatches = (guess, artist) => {
    const g = normalize(guess);
    const a = normalize(artist);
    if (!a) return false;
    return g.includes(a) || normalize(extractArtistFromGuess(guess)) === a;
  };

  // De un array de strings ("Titulo - Artista" / "Artista - Titulo"), saca posibles artistas
  const extractArtistsFromCandidates = (list = []) => {
    const out = new Set();
    (list || []).forEach(str => {
      if (!str) return;
      const [left, right] = splitTitleArtist(String(str));
      if (left)  out.add(left);
      if (right) out.add(right);
    });
    return out;
  };

  // Detecta "acierto parcial" aunque el flag venga con otro nombre o anidado
  function isPartialDeep(obj){
    const seen = new Set();
    const rec = (o) => {
      if (!o || typeof o !== "object" || seen.has(o)) return false;
      seen.add(o);
      for (const [k, v] of Object.entries(o)){
        const key = String(k).toLowerCase();
        if (typeof v === "boolean" && v && /(artist|artista|banda|band|group)/.test(key)) return true;
        if (typeof v === "string"  && /(partial|parcial|artist|artista|banda)/.test(v.toLowerCase())) return true;
        if (typeof v === "object" && rec(v)) return true;
      }
      return false;
    };
    return rec(obj);
  }

  // Obtiene el artista "conocido" en este momento (estado, payload, pista o UI)
  function getKnownArtist(data, fallbackAnswer) {
    if (currentArtist) return currentArtist;                     // estado guardado
    const fromData = data?.artista || data?.artist;              // payload API
    if (fromData) return fromData;
    const fromAns = extractArtistFromAnswer(fallbackAnswer || data?.answer); // "Canción - Artista"
    if (fromAns) return fromAns;
    // parseo del hint visible (como último recurso)
    const visible = (hintText?.innerText || hintText?.textContent || "").trim();
    if (visible) {
      const m = /(?:Artista|Artist|Banda)\s*:?\s*([^\n\r]+)/i.exec(visible);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  // Marca un intento como parcial y lo cachea por guess normalizado
  function markPartial(at){
    if (!at || at.correcta) return;
    at.parcial = true;
    if (at.guess) partialByGuess.set(normalize(at.guess), true);
  }

  // Reaplica parciales a una historia (cache + heurística por artista conocido)
  function applyPartialFlagsTo(history, knownArtist, data){
    if (!Array.isArray(history)) return;
    history.forEach(at => {
      if (!at || at.correcta) return;
      if (at.parcial) { // ya marcado
        partialByGuess.set(normalize(at.guess || ""), true);
        return;
      }
      const inCache = partialByGuess.get(normalize(at.guess || ""));
      if (inCache) { markPartial(at); return; }
      if (isPartialDeep(at) || isPartialDeep(data)) { markPartial(at); return; }
      if (knownArtist && artistMatches(at.guess, knownArtist)) { markPartial(at); return; }
      // candidatos del autocomplete
      if (candidateArtists && candidateArtists.size) {
        for (const cand of candidateArtists) {
          if (artistMatches(at.guess, cand)) { markPartial(at); break; }
        }
      }
    });
  }

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
  const autoList       = $("autocomplete-list", true);
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
    clearAudio(true);                 // reset duro: sin src

    // reset artista/candidatos/cache
    currentArtist = null;
    candidateArtists = new Set();
    partialByGuess = new Map();

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
    const req = ++hintReqSeq;
    currentPreviewUrl = null;
    btnPlayFragment.disabled = true;

    clearAudio(true); // remove src + load()

    const safeAttempt = Number.isFinite(currentAttempt) ? currentAttempt : 0;

    fetch(`/hint?attempt=${safeAttempt + 1}`)
      .then(ensureJSON)
      .then(data => {
        if (req !== hintReqSeq) return;  // llegó tarde, ignoramos

        if (data.error) {
          setHint(data.error);
          return;
        }
        if (data.pista && data.pista.trim() !== "") {
          setHint("💡 " + data.pista);
        } else {
          setHint("¡Escuchá el fragmento y adiviná la canción!");
        }

        // Guardamos artista de la ronda (para detectar "parcial")
        currentArtist = data.artista || data.artist || null;
        if (!currentArtist && typeof data.pista === "string") {
          const m = /(?:Artista|Artist|Banda)\s*:?\s*([^\n<]+)/i.exec(data.pista);
          if (m && m[1]) currentArtist = m[1].trim();
        }
        if (!currentArtist && typeof data.answer === "string") {
          currentArtist = extractArtistFromAnswer(data.answer);
        }

        // Derivamos artistas candidatos desde el autocomplete
        candidateArtists = extractArtistsFromCandidates(data.canciones_posibles || []);

        actualizarAutocomplete(data.canciones_posibles || []);

        if (data.preview_url) {
          currentPreviewUrl = data.preview_url;
          audioEl.src = currentPreviewUrl;
          audioEl.load();

          const enableIfMatch = () => {
            if (req === hintReqSeq && currentPreviewUrl && audioEl.src.includes(currentPreviewUrl)) {
              btnPlayFragment.disabled = false;
            }
            audioEl.oncanplay = audioEl.onloadeddata = audioEl.onloadedmetadata = null;
          };
          audioEl.oncanplay = enableIfMatch;
          audioEl.onloadeddata = enableIfMatch;
          audioEl.onloadedmetadata = enableIfMatch;
        } else {
          currentPreviewUrl = null;
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
    if (!currentPreviewUrl || !audioEl.src.includes(currentPreviewUrl)) {
      setHint("Preparando fragmento…");
      cargarHint();
      return;
    }

    clearAudio(); // pausa/limpia timers, mantiene src actual
    audioEl.currentTime = 0;
    audioEl.volume = 0.7;
    audioEl.play().catch(() => {
      alert("Tu navegador bloqueó la reproducción automática. Volvé a intentar.");
    });
    audioTimeout = setTimeout(() => {
      audioEl.pause();
      audioEl.currentTime = 0;
    }, (FRAGMENT_DURATIONS[currentAttempt] || 1) * 1000);
  });

  // ===== Permitir envíos vacíos y marcar "parcial" si corresponde (por intento) =====
  btnGuess.addEventListener("click", () => {
    if (!canInteract) return;

    const guess = (guessInput.value ?? ""); // puede ser vacío
    canInteract = false;     // evita doble click
    btnGuess.disabled = true;

    fetch("/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guess })
    })
      .then(ensureJSON)
      .then(data => {
        const attemptsFromSrv = (data.jugadas || []).length;

        // Reemplaza historia por la del server
        roundHistory = data.jugadas || [];
        currentAttempt = attemptsFromSrv;

        // Reaplicar parciales después del reemplazo (para no perderlos)
        const knownArtistEarly = getKnownArtist(data, data?.answer);
        applyPartialFlagsTo(roundHistory, knownArtistEarly, data);

        // Si el servidor aún NO devuelve esta jugada, la agregamos para pintarla ahora
        const lastFromSrv = roundHistory[roundHistory.length - 1];
        const sameAsLast = lastFromSrv && normalize(lastFromSrv.guess) === normalize(guess);
        if (!sameAsLast) {
          roundHistory.push({ guess, correcta: !!data.correcto });
          currentAttempt = roundHistory.length;
        }

        // Marcar PARCIAL SOLO en la última jugada (la actual), sin esperar fin de ronda
        const last = roundHistory[roundHistory.length - 1];
        if (last && !last.correcta) {
          let partial = false;

          // 1) Backend pudo marcarlo con otra clave/anidado
          partial = partial || isPartialDeep(last) || isPartialDeep(data);

          // 2) Por artista directo conocido (previamente derivado)
          partial = partial || (knownArtistEarly && artistMatches(last.guess, knownArtistEarly));

          // 3) Por artistas candidatos del autocomplete
          if (!partial && candidateArtists.size) {
            for (const cand of candidateArtists) {
              if (artistMatches(last.guess, cand)) { partial = true; break; }
            }
          }

          if (partial) markPartial(last);
        }

        guessInput.value = "";

        // En ramas finales, volver a reaplicar con artista de answer para no perder parciales
        if (data.correcto) {
          applyPartialFlagsTo(roundHistory, getKnownArtist(data, data?.answer), data);
          if (currentAttempt === 1 && window.confetti) {
            window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } });
          }
          setResult("¡Correcto! Era: " + data.answer, true);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else if (data.answer) {
          applyPartialFlagsTo(roundHistory, getKnownArtist(data, data?.answer), data);
          setResult("Fin del juego. Era: " + data.answer, false);
          btnNext.style.display = "block";
          playFullPreview(data.preview_url);
          actualizarHistorialGlobal();
        } else {
          setResult("Incorrecto", false);
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
  function actualizarIntentos() {
    attemptsBox.innerHTML = "";
    for (let i = 0; i < MAX_INTENTS; i++) {
      const estado = roundHistory[i]
        ? (roundHistory[i].correcta
            ? "correct"
            : ((roundHistory[i].parcial || isPartialDeep(roundHistory[i])) ? "partial" : "wrong"))
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
        if (it.correcta) {
          emoji = "✅"; clase = "correct";
        } else if (it.parcial || isPartialDeep(it)) {
          emoji = "🟡"; clase = "partial";
        } else {
          emoji = "❌"; clase = "wrong";
        }
        return `<span class="${clase}">${emoji} ${i + 1}: ${it.guess}</span>`;
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

  function actualizarAutocomplete(list) {
    if (!autoList) return;
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

  function clearAudio(resetSrc = false) {
    if (audioTimeout) clearTimeout(audioTimeout);
    audioTimeout = null;
    try { audioEl.pause(); } catch {}
    try { audioEl.currentTime = 0; } catch {}
    if (resetSrc) {
      try { audioEl.removeAttribute("src"); } catch {}
      try { audioEl.load(); } catch {}
    }
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
    clearAudio(true);
  }
});