"""Capa de 'proveedor de música': aísla al juego de la API concreta.

El resto de la app NO sabe que existe Deezer: solo le pide canciones a un
ProveedorMusica. Para cambiar de servicio (iTunes, otro) se implementa otra
subclase con la misma interfaz y se cambia UNA línea en app.py.

Contrato de datos: cada canción es un dict con las claves
    id, title, artist, album, duration, preview_url
"""

import re
import time
import requests
from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Tuple

from config import Juego

Cancion = Dict


class ProveedorMusica(ABC):
    """Interfaz común a cualquier fuente de música (Deezer, iTunes, etc.)."""

    nombre: str = "desconocido"

    @abstractmethod
    def obtener_canciones(self, playlist_id: str) -> List[Cancion]:
        """Devuelve las canciones (con preview) de una playlist."""

    @abstractmethod
    def extraer_id(self, texto: str) -> Optional[str]:
        """Extrae el ID de playlist desde un número o una URL del servicio."""


class DeezerProvider(ProveedorMusica):
    """Proveedor basado en la API pública de Deezer (previews de 30s, sin auth)."""

    nombre = "deezer"
    _TIMEOUT = 10  # segundos

    def __init__(self):
        # Caché en memoria: { playlist_id: (timestamp, canciones) }.
        self._cache: Dict[str, Tuple[float, List[Cancion]]] = {}

    def obtener_canciones(self, playlist_id: str) -> List[Cancion]:
        playlist_id = str(playlist_id)

        entrada = self._cache.get(playlist_id)
        if entrada and (time.time() - entrada[0]) < Juego.CACHE_TTL:
            return entrada[1]

        canciones: List[Cancion] = []
        url: Optional[str] = f"https://api.deezer.com/playlist/{playlist_id}"
        # La 1ra respuesta anida los tracks en data["tracks"]["data"];
        # las páginas siguientes vienen directamente en data["data"].
        primera = True

        try:
            while url:
                resp = requests.get(url, timeout=self._TIMEOUT)
                resp.raise_for_status()
                data = resp.json()

                bloque = data.get("tracks", {}) if primera else data
                primera = False

                for track in bloque.get("data", []):
                    if track.get("preview"):  # solo las que tienen audio
                        canciones.append(self._normalizar_track(track))

                url = bloque.get("next")  # siguiente página o None
        except requests.RequestException as e:
            print(f"[ERROR] No se pudo consultar Deezer: {e}")
            # Respaldo: si había algo cacheado (aunque venció), lo devolvemos.
            return entrada[1] if entrada else []

        if canciones:
            self._cache[playlist_id] = (time.time(), canciones)
        return canciones

    def extraer_id(self, texto: str) -> Optional[str]:
        texto = (texto or "").strip()
        m = re.search(r"playlist/(\d+)", texto)
        if m:
            return m.group(1)
        if texto.isdigit():
            return texto
        return None

    @staticmethod
    def _normalizar_track(track: Dict) -> Cancion:
        """Lleva un track de Deezer al formato común del juego."""
        return {
            "id": track.get("id", "?"),
            "title": track.get("title", "?"),
            "artist": track.get("artist", {}).get("name", "?"),
            "album": track.get("album", {}).get("title", "?"),
            "duration": track.get("duration", 0),
            "preview_url": track.get("preview", ""),
        }