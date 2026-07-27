"""Domain errors mapped to standard error envelopes."""
from __future__ import annotations


class ServiceError(Exception):
    code = "INTERNAL_ERROR"
    http_status = 500
    retryable = False

    def __init__(self, message: str, details: dict | None = None,
                 retryable: bool | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}
        if retryable is not None:
            self.retryable = retryable


class NotFoundError(ServiceError):
    code = "NOT_FOUND"
    http_status = 404


class ValidationError(ServiceError):
    code = "VALIDATION_ERROR"
    http_status = 422


class UpstreamError(ServiceError):
    code = "UPSTREAM_UNAVAILABLE"
    http_status = 502
    retryable = True
