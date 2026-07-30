import os


class Security:
    """Configuración sensible de la aplicación.

    La clave secreta NO debe quedar escrita en el código ni subirse al repo:
    se lee de la variable de entorno SECRET_KEY. El valor por defecto es
    solo para desarrollo local.
    """

    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-cambiame-en-produccion")


class Juego:
    """Parámetros de la lógica del juego (en un solo lugar para tocarlos fácil)."""

    MAX_INTENTOS: int = 5

    # Segundos que mantenemos cacheada una playlist en memoria.
    CACHE_TTL: int = 60 * 30  # 30 minutos

    # Los links de preview de Deezer vienen firmados y VENCEN. Pasado este
    # tiempo volvemos a pedirlos para que el audio no deje de cargar.
    PREVIEW_TTL: int = 60 * 15  # 15 minutos

    # Cuántas canciones conservamos en el historial global de la sesión.
    MAX_HISTORIAL_GLOBAL: int = 100

    # Puntaje según en qué intento (1..5) se acierta: más rápido, más puntos.
    PUNTOS = [6, 5, 4, 3, 2]
    # Consolación si no se acertó pero la respuesta mencionaba al artista.
    PUNTOS_PARCIAL = 1
