# TODO: swap for a CUDA or PyTorch base image that suits the chosen model.
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY handler.py .

CMD ["python", "-u", "handler.py"]
