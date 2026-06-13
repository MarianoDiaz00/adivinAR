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

    # Segundos que mantenemos cacheada una playlist de Deezer en memoria,
    # para no volver a pedirla en cada request.
    CACHE_TTL: int = 60 * 30  # 30 minutos