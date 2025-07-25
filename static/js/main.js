const fragmentDurations = [0.5, 1, 2, 4, 6];
const MAX_INTENTS = 5;

let currentAttempt = 0, historial = [], canContinue = true, audioTimeout = null;

const btnStartPlaylist = document.getElementById("start-with-playlist"),
      btnStartDefault  = document.getElementById("start-default"),
      btnPlayFragment  = document.getElementById("play-fragment"),
      btnGuess         = document.getElementById("guess-btn"),
      btnNext          = document.getElementById("reset-btn"),
      audioEl          = document.getElementById("audio-player"),
      hintText         = document.getElementById("hint-text"),
      attemptsBox      = document.getElementById("attempt-boxes"),
      attemptsRemain   = document.getElementById("attempts-remaining"),
      resultMsg        = document.getElementById("result-message"),
      historialEl      = document.getElementById("historial"),
      guessInput       = document.getElementById("guess-input"),
      autoList         = document.getElementById("autocomplete-list"),
      solvedListEl     = document.getElementById("solved-songs"),
      toggleDarkBtn    = document.getElementById("toggle-dark");

btnPlayFragment.disabled = true;

btnStartPlaylist.onclick = () => startGame(document.getElementById("playlist-input").value.trim());
btnStartDefault .onclick = () => startGame(null);

function startGame(playlist_id) {
  fetch("/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playlist_id })
  })
  .then(r => r.json())
  .then(data => {
    document.getElementById("playlist-select-screen").style.display = "none";
    document.getElementById("juego-main").style.display = "block";
    document.getElementById("playlist-info").textContent = data.playlist_name;
    actualizarHistorialGlobal();
    iniciarRonda();
  });
}

function iniciarRonda() {
  currentAttempt = 0;
  historial      = [];
  canContinue    = true;
  clearAudio();
  resultMsg.textContent = "";
  hintText.textContent = "¡Escuchá el fragmento y adiviná la canción!";
  historialEl.innerHTML = "";
  btnNext.style.display = "none";
  guessInput.value = "";
  btnPlayFragment.disabled = true;
  btnGuess.disabled = false;
  actualizarIntentos();
  mostrarHistorial();
  cargarHint();
}

function animarInputError() {
  const input = document.getElementById("guess-input");
  input.classList.remove("wrong-guess"); // Por si ya tenía la animación
  void input.offsetWidth; // Fuerza reflow
  input.classList.add("wrong-guess");
  setTimeout(() => input.classList.remove("wrong-guess"), 400);
}

function lanzarConfetti() {
  if (window.confetti) {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.5 }
    });
  }
}

function cargarHint() {
  btnPlayFragment.disabled = true;
  fetch(`/hint?attempt=${currentAttempt+1}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        hintText.textContent = data.error;
        return;
      }
       if (data.pista && data.pista.trim() !== "") {
        hintText.innerHTML = "💡 " + data.pista;
      } else {
        hintText.textContent = "¡Escuchá el fragmento y adiviná la canción!";
      }
      actualizarAutocomplete(data.canciones_posibles || []);
      if (data.preview_url) {
        audioEl.src = data.preview_url;
        audioEl.load();
        audioEl.oncanplay = () => {
          btnPlayFragment.disabled = false;
          audioEl.oncanplay = null;
        };
      }
    });
}

btnPlayFragment.onclick = () => {
  if (!canContinue || currentAttempt >= MAX_INTENTS) return;
  if (!audioEl.src) {
    alert("El fragmento no está listo. Esperá un momento.");
    return;
  }
  clearAudio();
  audioEl.currentTime = 0;
  audioEl.volume = 0.7;
  audioEl.play().catch(_ => alert("Hacé click de nuevo para reproducir."));
  audioTimeout = setTimeout(() => {
    audioEl.pause();
    audioEl.currentTime = 0;
  }, fragmentDurations[currentAttempt] * 1000);
};

btnGuess.onclick = () => {
  if (!canContinue) return;
  const guess = guessInput.value.trim();
  canContinue = false;
  btnGuess.disabled = true;

  fetch("/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guess })
  })
  .then(r => r.json())
  .then(data => {
    canContinue = true;
    guessInput.value = "";
    historial = data.jugadas || [];
    currentAttempt = historial.length;

    if (data.correcto) {
      lanzarConfetti();
      mostrarResultado("¡Correcto! Era: " + data.answer, true);
      btnNext.style.display = "block";
      if (data.preview_url) {
        audioEl.src = data.preview_url;
        audioEl.play();
      }
      actualizarHistorialGlobal();
    } else if (data.answer) {
      mostrarResultado("Fin del juego. Era: " + data.answer, false);
      btnNext.style.display = "block";
      if (data.preview_url) {
        audioEl.src = data.preview_url;
        audioEl.play();
      }
      actualizarHistorialGlobal();
    } else {
      animarInputError();
      mostrarResultado("Incorrecto", false);
      cargarHint()
      btnGuess.disabled = false;
    }
    actualizarIntentos();
    mostrarHistorial();
  });
};

btnNext.onclick = iniciarRonda;

function actualizarIntentos() {
  attemptsBox.innerHTML = "";
  for (let i = 0; i < MAX_INTENTS; i++) {
    const estado = historial[i]
      ? (historial[i].correcta ? "correct" : "wrong")
      : "empty";
    const span = document.createElement("span");
    span.className = "attempt-square " + estado;
    attemptsBox.appendChild(span);
  }
  attemptsRemain.innerHTML = `<b>${MAX_INTENTS - currentAttempt}</b> intentos restantes`;
}

function mostrarResultado(msg, ok) {
  resultMsg.textContent = msg;
  resultMsg.style.color = ok ? "var(--success)" : "var(--danger)";
}

function mostrarHistorial() {
  historialEl.innerHTML = "<b>Jugadas ronda actual:</b><br>" +
    historial.map((it, i) => {
      const emoji = it.correcta ? "✅" : "❌";
      return `<span class="${it.correcta ? 'correct' : 'wrong'}">
                ${emoji} ${i+1}: ${it.guess}
              </span>`;
    }).join("<br>");
}

function actualizarHistorialGlobal() {
  fetch("/historial-global")
    .then(r => r.json())
    .then(historial => {
      solvedListEl.innerHTML = "";
      historial.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item.titulo;
        li.style.color = item.correcta ? "var(--success)" : "var(--danger)";
        solvedListEl.appendChild(li);
      });
    });
}

function actualizarAutocomplete(list) {
  autoList.innerHTML = "";
  (list || []).forEach(c => {
    if (!c || c.includes("undefined")) return;
    const opt = document.createElement("option");
    opt.value = c;
    autoList.appendChild(opt);
  });
}

function clearAudio() {
  if (audioTimeout) clearTimeout(audioTimeout);
  audioEl.pause();
  audioEl.currentTime = 0;
}

toggleDarkBtn.onclick = () => {
  const body = document.body;
  const next = body.getAttribute("data-theme") === "dark" ? "light" : "dark";
  body.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
};
(function() {
  const body = document.body;
  const pref = localStorage.getItem("theme");
  if (pref) body.setAttribute("data-theme", pref);
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches)
    body.setAttribute("data-theme", "dark");
  else
    body.setAttribute("data-theme", "light");
})();
