class NotFoundError(Exception):
    """The requested record does not exist (HTTP 404)."""


class ConflictError(Exception):
    """The request clashes with the current state of a record (HTTP 409)."""


class InvalidRequestError(Exception):
    """The request is well formed but refers to something that is not valid (HTTP 422)."""


class ExtractionError(Exception):
    """The model could not read the order photo (HTTP 502). Staff enter the lines by hand."""


class RateLimitError(Exception):
    """Too many model calls this hour (HTTP 429). Protects the RunPod budget."""
