from flask import Flask, session, request, jsonify, render_template
import config, random
from juego import GameSession
from utilidades import playlist_deezer, extraer_id_playlist

# --- Configuración de la app ---
app = Flask(__name__)
app.secret_key = config.Security.SECRET_KEY

# Límite de intentos
MAX_INTENTOS = 5

# =======================
#  Playlists predefinidas
# =======================
# Editá esta lista para cambiar las playlists ofrecidas.
# id: ID (o link) de la playlist en Deezer
# nombre: cómo se mostrará al usuario
# genero: etiqueta informativa (opcional)
PLAYLISTS_PREDEFINIDAS = [
    {"id": "14395627421", "nombre": "Rock Nacional",           "genero": "Rock"},
    {"id": "14395627661", "nombre": "Rock Internacional",      "genero": "Rock"},
    {"id": "14094110361", "nombre": "Variedad Inglés",         "genero": "Mix EN"},
    {"id": "14094507901", "nombre": "Variedad Español",        "genero": "Mix ES"},
]

# Playlist por defecto (usada si el usuario no envía ninguna)
PLAYLIST_ID_DEFECTO = PLAYLISTS_PREDEFINIDAS[0]["id"]


# --- Funciones auxiliares ---
def nueva_lista_canciones(playlist_id: str):
    """
    Obtiene una lista de canciones mezcladas aleatoriamente.

    Parameters
    ----------
    playlist_id : str
        ID de la playlist en Deezer.

    Returns
    -------
    tuple[list[int], list[dict]]
        (indices mezclados, lista de canciones)
    """
    canciones = playlist_deezer(playlist_id)
    indices = list(range(len(canciones)))
    random.shuffle(indices)
    return indices, canciones


def nombre_playlist_desde_id(pid: str) -> str:
    """Devuelve el nombre de la playlist si está en las predefinidas; si no, 'Playlist {id}'."""
    for pl in PLAYLISTS_PREDEFINIDAS:
        if str(pl["id"]) == str(pid):
            return pl["nombre"]
    return f"Playlist {pid}"


# --- Rutas ---
@app.route("/")
def index():
    """Página principal. (Si querés poblar el select desde backend, se envían aquí también)."""
    return render_template("index.html", playlists=PLAYLISTS_PREDEFINIDAS)


@app.route("/api/playlists")
def api_playlists():
    """
    Devuelve la lista de playlists predefinidas en JSON.
    Útil para poblar el <select> del frontend dinámicamente.
    """
    return jsonify(PLAYLISTS_PREDEFINIDAS)


@app.route("/start", methods=["POST"])
def start():
    """
    Inicia una nueva sesión de juego.
    Resetea la posición, historial e índices de canciones.
    """
    data = request.get_json(force=True)
    entrada = data.get("playlist_id") or None
    nombre_boton = data.get("playlist_name")  # opcional (si lo mandás desde el front)

    # Si el usuario pegó un link, extraemos el ID; si no manda nada, usamos la default
    playlist_id = extraer_id_playlist(entrada) if entrada else PLAYLIST_ID_DEFECTO
    canciones = playlist_deezer(playlist_id)
    if not canciones:
        return jsonify({"error": "No se pudo obtener la playlist de Deezer"}), 400

    indices, _ = nueva_lista_canciones(playlist_id)
    session.update({
        "playlist_id": playlist_id,
        "playlist_indices": indices,
        "playlist_pos": 0,
        "historial": [],
        "historial_global": []
    })
    session.modified = True

    # Elegimos nombre de la playlist:
    # prioridad a nombre_boton (si viene del front), luego buscamos en las predefinidas, si no armamos genérico
    nombre = nombre_boton or nombre_playlist_desde_id(playlist_id)
    return jsonify({"message": "Juego iniciado", "playlist_name": nombre})


@app.route("/hint")
def hint():
    """
    Devuelve pistas progresivas sobre la canción actual
    según el número de intento.
    """
    playlist_id = session.get('playlist_id', PLAYLIST_ID_DEFECTO)
    playlist_indices = session.get('playlist_indices', [])
    playlist_pos = session.get('playlist_pos', 0)
    canciones = playlist_deezer(playlist_id)

    if not playlist_indices or playlist_pos >= len(playlist_indices):
        return jsonify({"error": "No hay más canciones."}), 400

    idx = playlist_indices[playlist_pos]
    cancion = canciones[idx]
    intento = int(request.args.get('attempt', 1))

    pistas = []
    if intento >= 2:
        pistas.append("❌ Respuesta incorrecta, sigue intentando.")
    if intento >= 3:
        mm, ss = divmod(cancion['duration'], 60)
        pistas.append(f"Duración: {mm}:{str(ss).zfill(2)}")
    if intento >= 4:
        pistas.append(f"Álbum: {cancion['album']}")
    if intento >= 5:
        pistas.append(f"Artista: {cancion['artist']}")

    autocomplete = [f"{x['title']} - {x['artist']}" for x in canciones]

    return jsonify({
        "preview_url": cancion['preview_url'],
        "pista": "<br>".join(pistas),
        "canciones_posibles": autocomplete
    })


@app.route("/guess", methods=["POST"])
def guess():
    """
    Procesa la respuesta del jugador y actualiza la sesión.
    Si acierta o agota intentos, pasa a la siguiente canción.
    """
    data = request.get_json(force=True)
    guess_txt = data.get("guess", "").strip()

    playlist_id = session.get('playlist_id', PLAYLIST_ID_DEFECTO)
    playlist_indices = session.get('playlist_indices', [])
    playlist_pos = session.get('playlist_pos', 0)
    canciones = playlist_deezer(playlist_id)

    if not playlist_indices or playlist_pos >= len(playlist_indices):
        return jsonify({"error": "No hay más canciones."}), 400

    idx = playlist_indices[playlist_pos]
    cancion = canciones[idx]
    game = GameSession(cancion)
    correcto = game.check_guess(guess_txt)

    # Historial de intentos actuales
    historial = session.get('historial', [])
    historial.append({"guess": guess_txt, "correcta": correcto})
    session['historial'] = historial

    answer = None
    if correcto or len(historial) >= MAX_INTENTOS:
        # Respuesta correcta o fin de intentos
        answer = f"{cancion['title']} - {cancion['artist']}"

        # Guardamos en historial global
        historial_global = session.get('historial_global', [])
        historial_global.append({
            "titulo": cancion['title'],
            "artista": cancion['artist'],
            "correcta": correcto
        })
        session['historial_global'] = historial_global

        # Avanzamos a siguiente canción
        playlist_pos += 1
        if playlist_pos >= len(playlist_indices):
            playlist_indices, _ = nueva_lista_canciones(playlist_id)
            playlist_pos = 0
            session['playlist_indices'] = playlist_indices

        session['playlist_pos'] = playlist_pos
        session['historial'] = []  # reset intentos

    session.modified = True

    return jsonify({
        "correcto": correcto,
        "answer": answer,
        "preview_url": cancion['preview_url'],
        "intentos_restantes": max(0, MAX_INTENTOS - len(historial)),
        "jugadas": historial,
        "historial_global": session.get('historial_global', [])
    })


@app.route("/historial-global")
def historial_global():
    """Devuelve el historial global de canciones jugadas."""
    return jsonify(session.get('historial_global', []))


@app.route("/reset", methods=["POST"])
def reset():
    """Reinicia la sesión del juego."""
    session.clear()
    return '', 204


if __name__ == "__main__":
    app.run(debug=True)