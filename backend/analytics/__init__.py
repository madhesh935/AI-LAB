"""Retail analytics engines (Phase 3): pure, deterministic logic with no camera, torch or database dependencies.

Inputs are anonymous, camera-local tracks (Phase 2 ByteTrack) in normalised image coordinates; outputs are
plain event dicts that the worker posts to the API's central event engine. All geometry comes from
configuration rows (camera_zones / queue_regions / shelf_regions) - nothing is hardcoded per camera.
"""
