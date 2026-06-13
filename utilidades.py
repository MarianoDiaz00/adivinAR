import re
import time
import requests
from typing import List, Dict, Optional, Tuple

from config import Juego

# Caché en memoria: { playlist_id: (timestamp, canciones) }.
# Evita pedirle la misma playlist a Deezer una y otra vez.
_CACHE: Dict[str, Tuple[float, List[Dict]]] = {}

# Tiempo máximo de espera por la API de Deezer (segundos).
_TIMEOUT = 10


def playlist_deezer(id_playlist: str, usar_cache: bool = True) -> List[Dict]:
    """Obtiene TODAS las canciones (con preview) de una playlist de Deezer.

    Sigue la paginación de Deezer para no quedarse solo con las primeras
    canciones, usa timeout, maneja errores de red y cachea el resultado
    durante CACHE_TTL segundos.

    Parameters
    ----------
    id_playlist : str
        ID de la playlist en Deezer.
    usar_cache : bool
        Si es False, ignora la caché y vuelve a pedir la playlist.

    Returns
    -------
    List[Dict]
        Canciones con los campos: id, title, artist, album, duration, preview_url.
    """
    id_playlist = str(id_playlist)

    if usar_cache:
        entrada = _CACHE.get(id_playlist)
        if entrada and (time.time() - entrada[0]) < Juego.CACHE_TTL:
            return entrada[1]

    canciones: List[Dict] = []
    url: Optional[str] = f"https://api.deezer.com/playlist/{id_playlist}"
    # La primera respuesta trae los tracks en data["tracks"]["data"];
    # las páginas siguientes vienen directamente en data["data"].
    primera = True

    try:
        while url:
            response = requests.get(url, timeout=_TIMEOUT)
            response.raise_for_status()
            data = response.json()

            bloque = data.get("tracks", {}) if primera else data
            primera = False

            for cancion in bloque.get("data", []):
                if cancion.get("preview"):  # solo las que tienen audio de preview
                    canciones.append(_normalizar_track(cancion))

            url = bloque.get("next")  # URL de la siguiente página, o None
    except requests.RequestException as e:
        print(f"[ERROR] No se pudo consultar Deezer: {e}")
        # Si teníamos algo cacheado (aunque esté vencido), lo usamos como respaldo.
        entrada = _CACHE.get(id_playlist)
        return entrada[1] if entrada else []

    if usar_cache and canciones:
        _CACHE[id_playlist] = (time.time(), canciones)

    return canciones


def _normalizar_track(cancion: Dict) -> Dict:
    """Extrae solo los campos que usa el juego de un track de Deezer."""
    return {
        "id": cancion.get("id", "?"),
        "title": cancion.get("title", "?"),
        "artist": cancion.get("artist", {}).get("name", "?"),
        "album": cancion.get("album", {}).get("title", "?"),
        "duration": cancion.get("duration", 0),
        "preview_url": cancion.get("preview", ""),
    }


def extraer_id_playlist(texto: str) -> Optional[str]:
    """Extrae el ID de una playlist desde un número o una URL de Deezer."""
    texto = texto.strip()
    m = re.search(r"playlist/(\d+)", texto)
    if m:
        return m.group(1)
    if texto.isdigit():
        return texto
    return None