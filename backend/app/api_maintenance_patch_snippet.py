# Ajouter dans backend/app/api.py
# 1) avec les imports routers :
from app.routers.maintenance_report_router import router as maintenance_report_router

# 2) après app.include_router(ml_router, prefix="/ml", tags=["Machine Learning"]) :
app.include_router(maintenance_report_router, prefix="/maintenance", tags=["Rapport Exécutif"])
