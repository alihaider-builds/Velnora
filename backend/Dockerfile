FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend

COPY backend/pyproject.toml backend/README.md ./
COPY backend/app ./app
RUN pip install --no-cache-dir -e .   # editable: keeps paths relative to /app/backend

# Sample data for `python -m app.seed`
COPY data /app/data

RUN useradd --create-home relieflens && mkdir -p storage && chown -R relieflens storage
USER relieflens

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
