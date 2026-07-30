import os
import random
import time

from flask import Flask, session, request, jsonify, render_template
from flask_session import Session

import config
from juego import GameSession
from proveedores import DeezerProvider

# --- Configuración de la app ---
app = Flask(__name__)
app.secret_key = config.Security.SECRET_KEY

# Sesión del lado del servidor (Flask-Session): guardamos canciones, historial
# y puntaje, que no entran en la cookie de ~4 KB que usa Flask por defecto.
app.config.update(
    SESSION_TYPE="filesystem",
    SESSION_PERMANENT=False,
)
Session(app)

MAX_INTENTOS = config.Juego.MAX_INTENTOS

# === Proveedor de música ===
# Para cambiar de servicio, se reemplaza SOLO esta línea por otra subclase.
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
    for pl in PLAYLISTS_PREDEFINIDAS:
        if str(pl["id"]) == str(pid):
            return pl["nombre"]
    return f"Playlist {pid}"


def refrescar_previews() -> bool:
    """Vuelve a pedir la playlist y renueva los links de preview.

    Los links de Deezer vienen firmados y vencen a los ~20-40 min, así que
    los que guardamos al iniciar la partida dejan de funcionar si la sesión
    se hace larga. Actualizamos SOLO el campo preview_url de cada canción,
    buscándola por id: así los índices barajados siguen siendo válidos.

    Returns
    -------
    bool
        True si se pudo refrescar.
    """
    playlist_id = session.get("playlist_id", PLAYLIST_ID_DEFECTO)
    frescas = PROVEEDOR.obtener_canciones(playlist_id, refrescar=True)
    if not frescas:
        return False

    nuevos = {str(c["id"]): c["preview_url"] for c in frescas}
    canciones = session.get("canciones") or []
    for c in canciones:
        nuevo = nuevos.get(str(c["id"]))
        if nuevo:
            c["preview_url"] = nuevo

    session["canciones"] = canciones
    session["canciones_ts"] = time.time()
    return True


def ronda_actual(refrescar: bool = False):
    """Devuelve (GameSession, error). Lee todo de la sesión.

    Si los links de preview están vencidos (o el front avisa que falló el
    audio con refrescar=True), los renueva antes de responder.
    """
    canciones = session.get("canciones")
    orden = session.get("playlist_indices", [])
    pos = session.get("playlist_pos", 0)

    if canciones is None:  # la sesión expiró o se perdió: recargar
        canciones = PROVEEDOR.obtener_canciones(
            session.get("playlist_id", PLAYLIST_ID_DEFECTO)
        )
        session["canciones"] = canciones
        session["canciones_ts"] = time.time()

    # Renovación de links vencidos (a pedido del front o por antigüedad)
    vencido = (time.time() - session.get("canciones_ts", 0)) > config.Juego.PREVIEW_TTL
    if refrescar or vencido:
        refrescar_previews()
        canciones = session.get("canciones") or canciones

    if not orden or pos >= len(orden):
        return None, (jsonify({"error": "No hay más canciones."}), 400)

    return GameSession(canciones[orden[pos]]), None


def lista_autocomplete():
    """Títulos de la playlist para el autocompletado del frontend."""
    return [f"{c['title']} - {c['artist']}" for c in (session.get("canciones") or [])]


def puntos_por_acierto(intento: int) -> int:
    """Puntos al acertar en un intento dado (1-based). Más rápido, más puntos."""
    idx = min(intento, len(config.Juego.PUNTOS)) - 1
    return config.Juego.PUNTOS[idx]


# --- Anti-caché de archivos estáticos ---
@app.context_processor
def version_assets():
    """Expone ASSET_V a las plantillas: cambia cuando cambian css/js.

    Sirve para que el navegador no siga usando una versión vieja de
    main.js o style.css después de editarlos.
    """
    marcas = []
    for rel in ("static/js/main.js", "static/css/style.css"):
        ruta = os.path.join(app.root_path, rel)
        try:
            marcas.append(str(int(os.path.getmtime(ruta))))
        except OSError:
            marcas.append("0")
    return {"ASSET_V": "-".join(marcas)}


# --- Rutas ---
@app.route("/")
def index():
    return render_template("index.html", playlists=PLAYLISTS_PREDEFINIDAS)


@app.route("/api/playlists")
def api_playlists():
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
        "canciones": canciones,
        "canciones_ts": time.time(),
        "playlist_indices": indices,
        "playlist_pos": 0,
        "historial": [],
        "historial_global": [],
        "puntaje": 0,
    })

    nombre = nombre_boton or nombre_playlist_desde_id(playlist_id)
    return jsonify({
        "message": "Juego iniciado",
        "playlist_name": nombre,
        "puntaje": 0,
        # La mandamos UNA vez al arrancar; el front la cachea y no la vuelve
        # a pedir en cada intento (antes viajaba entera en cada pista).
        "canciones_posibles": lista_autocomplete(),
    })


@app.route("/hint")
def hint():
    """Pistas progresivas sobre la canción actual según el intento.

    Si el front manda refresh=1 es porque el audio no cargó: renovamos los
    links de preview y devolvemos uno nuevo.
    """
    refrescar = request.args.get("refresh") == "1"
    game, error = ronda_actual(refrescar=refrescar)
    if error:
        return error

    intento = int(request.args.get("attempt", 1))
    pistas = game.generar_pistas(intento)

    respuesta = {
        "preview_url": game.cancion["preview_url"],
        "pista": "<br>".join(pistas),
    }
    # Solo si el front avisa que no tiene la lista (por ejemplo, si el usuario
    # recargó la página en medio de la partida).
    if request.args.get("lista") == "1":
        respuesta["canciones_posibles"] = lista_autocomplete()

    return jsonify(respuesta)


@app.route("/guess", methods=["POST"])
def guess():
    """Procesa la respuesta. Si acierta o agota intentos, puntúa y avanza."""
    data = request.get_json(force=True)
    guess_txt = data.get("guess", "").strip()

    game, error = ronda_actual()
    if error:
        return error

    cancion = game.cancion
    correcto, parcial = game.evaluar(guess_txt)  # el backend conoce al artista

    historial = session.get("historial", [])
    historial.append({"guess": guess_txt, "correcta": correcto, "parcial": parcial})
    session["historial"] = historial

    answer = None
    puntos_ronda = None
    if correcto or len(historial) >= MAX_INTENTOS:
        answer = f"{cancion['title']} - {cancion['artist']}"

        # --- Puntaje ---
        if correcto:
            puntos_ronda = puntos_por_acierto(len(historial))
        else:
            hubo_parcial = any(j.get("parcial") for j in historial)
            puntos_ronda = config.Juego.PUNTOS_PARCIAL if hubo_parcial else 0
        session["puntaje"] = session.get("puntaje", 0) + puntos_ronda

        # Historial global (acotado para que la sesión no crezca sin límite)
        historial_global = session.get("historial_global", [])
        historial_global.append({
            "titulo": cancion["title"],
            "artista": cancion["artist"],
            "correcta": correcto,
        })
        session["historial_global"] = historial_global[-config.Juego.MAX_HISTORIAL_GLOBAL:]

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
        "puntos_ronda": puntos_ronda,
        "puntaje": session.get("puntaje", 0),
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
    # debug=True es solo para desarrollo local. En producción usá gunicorn.
    app.run(debug=True)
