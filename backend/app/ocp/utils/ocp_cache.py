import os
import threading
from pathlib import Path

import pandas as pd

from app.ocp.utils.data_processing import clean_data, label_points, load_data


_LOCK = threading.Lock()
_CACHE = {
    "path": None,
    "mtime": None,
    "df": None,
    "labels": None,
}


def load_clean_cached(current_file: str) -> pd.DataFrame:
    path = Path(current_file)
    if not path.is_file():
        raise FileNotFoundError(current_file)
    mtime = os.path.getmtime(path)
    with _LOCK:
        if _CACHE["path"] == str(path) and _CACHE["mtime"] == mtime and _CACHE["df"] is not None:
            return _CACHE["df"]
        df = clean_data(load_data(str(path)))
        _CACHE.update({"path": str(path), "mtime": mtime, "df": df, "labels": None})
        return df


def labels_cached(current_file: str):
    df = load_clean_cached(current_file)
    path = Path(current_file)
    mtime = os.path.getmtime(path)
    with _LOCK:
        if _CACHE["path"] == str(path) and _CACHE["mtime"] == mtime and _CACHE["labels"] is not None:
            return _CACHE["labels"]
        labels = label_points(df)
        _CACHE["labels"] = labels
        return labels
