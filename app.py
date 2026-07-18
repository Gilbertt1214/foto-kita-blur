from flask import Flask, render_template, send_from_directory
import os

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/model/<path:filename>")
def serve_model(filename):
    """Serve the MediaPipe hand landmarker model file."""
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), filename)


if __name__ == "__main__":
    print()
    print("  ✌️  Peace Blur — Foto Kita")
    print("  ─────────────────────────────")
    print("  Buka di browser: http://localhost:5000")
    print()
    app.run(debug=True, host="0.0.0.0", port=5000)
