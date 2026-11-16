# Python dependencies of the backend by role, shared by the packages and the
# dev shell. `api` and `analysis` mirror the extras in backend/pyproject.toml.
ps: {
  core = with ps; [
    pydantic
    pydantic-settings
  ];
  api = with ps; [
    alembic
    fastapi
    numpy
    python-multipart
    soundfile
    sqlalchemy
    uvicorn
  ];
  analysis = with ps; [
    httpx
    numpy
    praat-parselmouth
    soundfile
  ];
  dev = with ps; [
    httpx # NOTE: required by FastAPI's TestClient
    pytest
  ];
}
