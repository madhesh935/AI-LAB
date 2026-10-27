"""RetailEdge vision worker: camera ingestion, person detection, ByteTrack tracking, MJPEG gateway.

Runs as its OWN process (python -m vision) so continuous blocking capture/inference never
shares a thread with FastAPI request handling.
"""
