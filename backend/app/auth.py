"""
Module d'authentification JWT pour MineAssist 994F
Gestion des utilisateurs, hachage des mots de passe, tokens JWT
"""

import os
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, status, APIRouter
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from jose import JWTError, jwt
from pydantic import BaseModel

# ── Configuration ─────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "mineassist-994f-secret-key-change-in-production-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

USERS_FILE = Path(__file__).parent.parent / "data" / "users.json"

# ── Crypto ─────────────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
security = HTTPBearer()

# ── Modèles ────────────────────────────────────────────────────────────────


class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    nom_complet: str
    role: str = "technicien"  # admin | chef | technicien
    email: Optional[str] = None


class UserResponse(BaseModel):
    username: str
    nom_complet: str
    role: str
    email: Optional[str]


# ── Permissions ────────────────────────────────────────────────────────────
ROLES_PERMISSIONS = {
    "admin": ["all"],
    "chef": [
        "ask", "diagnose", "gmao", "monitor", "anomaly", "evolution", "geo", "export",
        "capteurs", "oil", "ocp_upload", "ocp_defaut", "ocp_sante", "prediction",
        "alertes_ocp", "maintenance_360", "executive_report",
    ],
    "technicien": ["ask", "diagnose", "monitor", "capteurs", "oil", "maintenance_360", "executive_report"],
}


# ── Helpers utilisateurs ───────────────────────────────────────────────────
def _default_users() -> dict:
    return {
        "admin": {
            "username": "admin",
            "hashed_password": pwd_context.hash("admin123"),
            "nom_complet": "Administrateur Systeme",
            "role": "admin",
            "email": "admin@ocp.ma",
            "actif": True,
        },
        "chef": {
            "username": "chef",
            "hashed_password": pwd_context.hash("chef123"),
            "nom_complet": "Chef de Service Maintenance",
            "role": "chef",
            "email": "younessbilouche@gmail.com",
            "actif": True,
        },
        "tech1": {
            "username": "tech1",
            "hashed_password": pwd_context.hash("tech123"),
            "nom_complet": "Technicien Terrain",
            "role": "technicien",
            "email": None,
            "actif": True,
        },
    }


def _save_users(users: dict):
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(
        json.dumps(users, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def _load_users() -> dict:
    """
    Charge les utilisateurs depuis le fichier JSON.
    Si le fichier n'existe pas, il est créé automatiquement.
    Si le fichier est corrompu ou mal encodé, il est recréé.
    """
    if not USERS_FILE.exists():
        users = _default_users()
        _save_users(users)
        return users

    try:
        content = USERS_FILE.read_text(encoding="utf-8")
        return json.loads(content)
    except UnicodeDecodeError:
        try:
            content = USERS_FILE.read_text(encoding="utf-8-sig")
            users = json.loads(content)
            _save_users(users)
            return users
        except Exception:
            users = _default_users()
            _save_users(users)
            return users
    except json.JSONDecodeError:
        users = _default_users()
        _save_users(users)
        return users
    except Exception:
        users = _default_users()
        _save_users(users)
        return users


def get_user(username: str) -> Optional[dict]:
    users = _load_users()
    return users.get(username)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def authenticate_user(username: str, password: str) -> Optional[dict]:
    user = get_user(username)
    if not user:
        return None
    if not user.get("actif", True):
        return None
    if not verify_password(password, user["hashed_password"]):
        return None
    return user


# ── JWT ────────────────────────────────────────────────────────────────────
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Token invalide")
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Dépendances FastAPI ───────────────────────────────────────────────────
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    payload = decode_token(credentials.credentials)
    username = payload.get("sub")
    user = get_user(username)
    if user is None or not user.get("actif", True):
        raise HTTPException(status_code=401, detail="Utilisateur non trouvé ou désactivé")
    return user


def require_role(*roles: str):
    def checker(current_user: dict = Depends(get_current_user)):
        if "admin" in roles or current_user["role"] == "admin":
            return current_user
        if current_user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé. Rôle requis : {', '.join(roles)}"
            )
        return current_user
    return checker


# ── Routes d'authentification ─────────────────────────────────────────────
auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post("/login", response_model=Token)
async def login(request: LoginRequest):
    user = authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nom d'utilisateur ou mot de passe incorrect",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={
            "sub": user["username"],
            "role": user["role"],
            "nom": user["nom_complet"],
        }
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        user={
            "username": user["username"],
            "nom_complet": user["nom_complet"],
            "role": user["role"],
            "email": user.get("email"),
        }
    )


@auth_router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        username=current_user["username"],
        nom_complet=current_user["nom_complet"],
        role=current_user["role"],
        email=current_user.get("email"),
    )


@auth_router.post("/change-password")
async def change_password(
    old_password: str,
    new_password: str,
    current_user: dict = Depends(get_current_user)
):
    if not verify_password(old_password, current_user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Ancien mot de passe incorrect")

    if len(new_password) < 6:
        raise HTTPException(
            status_code=400, detail="Le nouveau mot de passe doit faire au moins 6 caractères")

    users = _load_users()
    users[current_user["username"]]["hashed_password"] = pwd_context.hash(new_password)
    _save_users(users)
    return {"message": "Mot de passe modifié avec succès"}


@auth_router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    current_user: dict = Depends(require_role("admin"))
):
    users = _load_users()

    if user_data.username in users:
        raise HTTPException(status_code=400, detail="Nom d'utilisateur déjà pris")

    if len(user_data.password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe trop court (min 6 caractères)")

    users[user_data.username] = {
        "username": user_data.username,
        "hashed_password": pwd_context.hash(user_data.password),
        "nom_complet": user_data.nom_complet,
        "role": user_data.role,
        "email": user_data.email,
        "actif": True,
    }
    _save_users(users)

    return UserResponse(
        username=user_data.username,
        nom_complet=user_data.nom_complet,
        role=user_data.role,
        email=user_data.email,
    )


@auth_router.get("/users")
async def list_users(current_user: dict = Depends(require_role("admin", "chef"))):
    users = _load_users()
    return [
        {
            "username": u["username"],
            "nom_complet": u["nom_complet"],
            "role": u["role"],
            "email": u.get("email"),
            "actif": u.get("actif", True),
        }
        for u in users.values()
    ]


@auth_router.delete("/users/{username}")
async def delete_user(
    username: str,
    current_user: dict = Depends(require_role("admin"))
):
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Impossible de se supprimer soi-même")

    users = _load_users()
    if username not in users:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    del users[username]
    _save_users(users)
    return {"message": f"Utilisateur '{username}' supprimé"}
