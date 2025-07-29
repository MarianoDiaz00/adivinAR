from flask import Flask, session, request, jsonify, render_template
import config, random
from juego import GameSession
from utilidades import playlist_deezer, extraer_id_playlist

app = Flask(__name__)
app.secret_key = config.Security.SECRET_KEY

PLAYLIST_ID_DEFECTO = "14072713181"
MAX_INTENTS = 5

PLAYLISTS = [
    {"id": "14072713181", "name": "Predeterminada"},
    {"id": "14089683421", "name": "Rock Internacional"},
    {"id": "14094110361", "name": "Musica Variedad Ingles"},
    {"id": "14094507901", "name": "Musica Variedad Español"}
]

def nueva_lista_canciones(playlist_id):
    canciones = playlist_deezer(playlist_id)
    indices = list(range(len(canciones)))
    random.shuffle(indices)
    return indices, canciones

@app.route("/")
def index():
    return render_template("index.html", playlists=PLAYLISTS)

@app.route("/start", methods=["POST"])
def start():
    data = request.get_json(force=True)
    entrada = data.get("playlist_id") or None
    nombre_boton = data.get("playlist_name")
    if entrada:
        playlist_id = extraer_id_playlist(entrada)
    else:
        playlist_id = PLAYLIST_ID_DEFECTO

    canciones = playlist_deezer(playlist_id)
    if not canciones:
        return jsonify({"error": "No se pudo obtener la playlist de Deezer"}), 400

    indices, canciones_actuales = nueva_lista_canciones(playlist_id)
    session['playlist_id']      = playlist_id
    session['playlist_indices'] = indices
    session['playlist_pos']     = 0
    session['historial']        = []
    session['historial_global'] = []
    session.modified = True

    if nombre_boton:
        nombre = nombre_boton
    else:
        nombre = f"Playlist {playlist_id}"
    return jsonify({"message": "Juego iniciado", "playlist_name": nombre})

@app.route("/hint")
def hint():
    playlist_id = session.get('playlist_id', PLAYLIST_ID_DEFECTO)
    playlist_indices = session.get('playlist_indices', [])
    playlist_pos = session.get('playlist_pos', 0)
    canciones = playlist_deezer(playlist_id)

    if not playlist_indices or playlist_pos >= len(playlist_indices):
        return jsonify({"error": "No hay más canciones."}), 400

    idx = playlist_indices[playlist_pos]
    c = canciones[idx]
    intento = int(request.args.get('attempt', 1))

    pistas = []
    if intento >= 2:
        pistas.append("Error!, sigue intentado")
    if intento >= 3:
        mm = c['duration'] // 60
        ss = str(c['duration'] % 60).zfill(2)
        pistas.append(f"Duración: {mm}:{ss}")
    if intento >= 4:
        pistas.append(f"Álbum: {c['album']}")
    if intento >= 5:
        pistas.append(f"Artista: {c['artist']}")

    autocomplete = [f"{x['title']} - {x['artist']}" for x in canciones]

    return jsonify({
        "preview_url": c['preview_url'],
        "pista":       "<br>".join(pistas),
        "canciones_posibles": autocomplete
    })

@app.route("/guess", methods=["POST"])
def guess():
    data  = request.get_json(force=True)
    guess = data.get("guess","").strip()
    playlist_id = session.get('playlist_id', PLAYLIST_ID_DEFECTO)
    playlist_indices = session.get('playlist_indices', [])
    playlist_pos = session.get('playlist_pos', 0)
    canciones = playlist_deezer(playlist_id)

    if not playlist_indices or playlist_pos >= len(playlist_indices):
        return jsonify({"error": "No hay más canciones."}), 400

    idx = playlist_indices[playlist_pos]
    c = canciones[idx]
    game = GameSession(c)
    correcta = game.check_guess(guess)

    historial = session.get('historial', [])
    historial.append({"guess": guess, "correcta": correcta})
    session['historial'] = historial

    answer = None
    if correcta or len(historial) >= MAX_INTENTS:
        answer = f"{c['title']} - {c['artist']}"

        historial_global = session.get('historial_global', [])
        historial_global.append({
            "titulo": c['title'],
            "artista": c['artist'],
            "correcta": correcta
        })
        session['historial_global'] = historial_global

        playlist_pos += 1
        # Si terminan las canciones, reshuffleamos (esto puede mejorarse si se quiere evitar repeticiones eternas)
        if playlist_pos >= len(playlist_indices):
            playlist_indices, _ = nueva_lista_canciones(playlist_id)
            playlist_pos = 0
            session['playlist_indices'] = playlist_indices

        session['playlist_pos'] = playlist_pos
        session['historial'] = []

    session.modified = True

    return jsonify({
        "correcto": correcta,
        "answer": answer,
        "preview_url": c['preview_url'],
        "intentos_restantes": max(0, MAX_INTENTS - len(historial)),
        "jugadas": historial,
        "historial_global": session.get('historial_global', [])
    })

@app.route("/historial-global")
def historial_global():
    return jsonify(session.get('historial_global', []))

@app.route("/reset", methods=["POST"])
def reset():
    session.clear()
    return '', 204


if __name__ == "__main__":
    app.run()