import random

from flask import Flask, session, request, jsonify, render_template
from flask_session import Session

import config
from juego import GameSession
from proveedores import DeezerProvider

# --- Configuración de la app ---
app = Flask(__name__)
app.secret_key = config.Security.SECRET_KEY

# Sesión del lado del servidor (Flask-Session). Necesaria porque guardamos
# la lista de canciones y el historial en la sesión, y eso no entra en la
# cookie de ~4 KB que usa Flask por defecto.
app.config.update(
    SESSION_TYPE="filesystem",
    SESSION_PERMANENT=False,
)
Session(app)

MAX_INTENTOS = config.Juego.MAX_INTENTOS

# === Proveedor de música ===
# Para cambiar de servicio, se reemplaza SOLO esta línea por otra subclase
# de ProveedorMusica (p. ej. ItunesProvider()).
PROVEEDOR = DeezerProvider()

# =======================
#  Playlists predefinidas
# =======================
PLAYLISTS_PREDEFINIDAS = [
    {"id": "14395627421", "nombre": "Rock Nacional",      "genero": "Rock"},
    {"id": "14395627661", "nombre": "Rock Internacional", "genero": "Rock"},
    {"id": "14094110361", "nombre": "Variedad Inglés",    "genero": "Mix EN"},
    {"id": "14094507901", "nombre": "Variedad Español",   "genero": "Mix ES"},
]
PLAYLIST_ID_DEFECTO = PLAYLISTS_PREDEFINIDAS[0]["id"]


# --- Funciones auxiliares ---
def nombre_playlist_desde_id(pid: str) -> str:
    """Nombre de la playlist si está en las predefinidas; si no, genérico."""
    for pl in PLAYLISTS_PREDEFINIDAS:
        if str(pl["id"]) == str(pid):
            return pl["nombre"]
    return f"Playlist {pid}"


def ronda_actual():
    """Devuelve (GameSession, error).

    Lee TODO de la sesión, sin volver a pegarle al proveedor. Si la sesión
    perdió la lista de canciones (expiró), la recarga una sola vez.
    """
    canciones = session.get("canciones")
    orden = session.get("playlist_indices", [])
    pos = session.get("playlist_pos", 0)

    if canciones is None:  # la sesión expiró o se perdió: recargar
        canciones = PROVEEDOR.obtener_canciones(
            session.get("playlist_id", PLAYLIST_ID_DEFECTO)
        )
        session["canciones"] = canciones

    if not orden or pos >= len(orden):
        return None, (jsonify({"error": "No hay más canciones."}), 400)

    return GameSession(canciones[orden[pos]]), None


# --- Rutas ---
@app.route("/")
def index():
    return render_template("index.html", playlists=PLAYLISTS_PREDEFINIDAS)


@app.route("/api/playlists")
def api_playlists():
    """Lista de playlists predefinidas en JSON (para poblar el <select>)."""
    return jsonify(PLAYLISTS_PREDEFINIDAS)


@app.route("/start", methods=["POST"])
def start():
    """Inicia una nueva sesión de juego. Pide la playlist UNA sola vez."""
    data = request.get_json(force=True)
    entrada = data.get("playlist_id") or None
    nombre_boton = data.get("playlist_name")

    playlist_id = PROVEEDOR.extraer_id(entrada) if entrada else PLAYLIST_ID_DEFECTO

    canciones = PROVEEDOR.obtener_canciones(playlist_id)
    if not canciones:
        return jsonify({"error": "No se pudo obtener la playlist"}), 400

    indices = list(range(len(canciones)))
    random.shuffle(indices)

    session.update({
        "playlist_id": playlist_id,
        "canciones": canciones,          # lista completa, guardada una vez
        "playlist_indices": indices,
        "playlist_pos": 0,
        "historial": [],
        "historial_global": [],
    })

    nombre = nombre_boton or nombre_playlist_desde_id(playlist_id)
    return jsonify({"message": "Juego iniciado", "playlist_name": nombre})


@app.route("/hint")
def hint():
    """Pistas progresivas sobre la canción actual según el intento."""
    game, error = ronda_actual()
    if error:
        return error

    intento = int(request.args.get("attempt", 1))
    pistas = game.generar_pistas(intento)

    canciones = session.get("canciones", [])
    autocomplete = [f"{x['title']} - {x['artist']}" for x in canciones]

    return jsonify({
        "preview_url": game.cancion["preview_url"],
        "pista": "<br>".join(pistas),
        "canciones_posibles": autocomplete,
    })


@app.route("/guess", methods=["POST"])
def guess():
    """Procesa la respuesta. Si acierta o agota intentos, pasa a la siguiente."""
    data = request.get_json(force=True)
    guess_txt = data.get("guess", "").strip()

    game, error = ronda_actual()
    if error:
        return error

    cancion = game.cancion
    correcto, parcial = game.evaluar(guess_txt)  # el backend ya conoce al artista

    historial = session.get("historial", [])
    historial.append({"guess": guess_txt, "correcta": correcto, "parcial": parcial})
    session["historial"] = historial

    answer = None
    if correcto or len(historial) >= MAX_INTENTOS:
        answer = f"{cancion['title']} - {cancion['artist']}"

        historial_global = session.get("historial_global", [])
        historial_global.append({
            "titulo": cancion["title"],
            "artista": cancion["artist"],
            "correcta": correcto,
        })
        session["historial_global"] = historial_global

        # Avanzar; si se acabó la lista, remezclar (sin volver a pedir nada).
        indices = session.get("playlist_indices", [])
        pos = session.get("playlist_pos", 0) + 1
        if pos >= len(indices):
            random.shuffle(indices)
            session["playlist_indices"] = indices
            pos = 0
        session["playlist_pos"] = pos
        session["historial"] = []  # reset de intentos

    return jsonify({
        "correcto": correcto,
        "parcial": parcial,
        "answer": answer,
        "preview_url": cancion["preview_url"],
        "intentos_restantes": max(0, MAX_INTENTOS - len(historial)),
        "jugadas": historial,
        "historial_global": session.get("historial_global", []),
    })


@app.route("/historial-global")
def historial_global():
    return jsonify(session.get("historial_global", []))


@app.route("/reset", methods=["POST"])
def reset():
    session.clear()
    return "", 204


if __name__ == "__main__":
    # debug=True es solo para desarrollo local.
    # En producción usá gunicorn (ya está en requirements.txt).
    app.run(debug=True)