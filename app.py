"""
Aplicación principal de Flask para el juego de adivinar la canción.
"""

from flask import Flask, session, request, jsonify, render_template
import config, random
from juego import GameSession
from utilidades import playlist_deezer, extraer_id_playlist


# --- Configuración de la app ---
app = Flask(__name__)
app.secret_key = config.Security.SECRET_KEY

# Playlist por defecto y límite de intentos
PLAYLIST_ID_DEFECTO = "14072713181"
MAX_INTENTOS = 5

# Playlists disponibles en la interfaz
PLAYLISTS = [
    {"id": "14072713181", "name": "Predeterminada"},
    {"id": "14089683421", "name": "Rock Internacional"},
    {"id": "14094110361", "name": "Música Variedad Inglés"},
    {"id": "14094507901", "name": "Música Variedad Español"},
]


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


# --- Rutas ---
@app.route("/")
def index():
    """Página principal con selección de playlists."""
    return render_template("index.html", playlists=PLAYLISTS)


@app.route("/start", methods=["POST"])
def start():
    """
    Inicia una nueva sesión de juego.
    Resetea la posición, historial e índices de canciones.
    """
    data = request.get_json(force=True)
    entrada = data.get("playlist_id") or None
    nombre_boton = data.get("playlist_name")

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

    nombre = nombre_boton or f"Playlist {playlist_id}"
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
    correcta = game.check_guess(guess_txt)

    # Historial de intentos actuales
    historial = session.get('historial', [])
    historial.append({"guess": guess_txt, "correcta": correcta})
    session['historial'] = historial

    answer = None
    if correcta or len(historial) >= MAX_INTENTOS:
        # Respuesta correcta o fin de intentos
        answer = f"{cancion['title']} - {cancion['artist']}"

        # Guardamos en historial global
        historial_global = session.get('historial_global', [])
        historial_global.append({
            "titulo": cancion['title'],
            "artista": cancion['artist'],
            "correcta": correcta
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
        "correcto": correcta,
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