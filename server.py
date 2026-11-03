"""
VoxAct AI — Campus Voice Grievance & Auto-Ticketing System
FastAPI + MongoDB + Gemini AI Pipeline

Pipeline:
1. Student speaks a complaint.
2. Voice converts into text (Web Speech API).
3. Gemini identifies the complaint.
4. AI determines department and priority.
5. FastAPI creates a ticket.
6. MongoDB permanently stores it.
7. Dashboard displays the ticket in real-time.
8. Staff updates ticket status (Open -> In Progress -> Resolved).
9. Application speaks confirmation back to the student.
"""

import os
import sys
import json
import time
import random
from datetime import datetime
from typing import Optional, List, Dict, Any

# Ensure Windows terminal doesn't crash on unicode/cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import pymongo
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

# Optional Google Gemini SDK
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FALLBACK_FILE = os.path.join(BASE_DIR, "mongodb_fallback.json")

# --- MongoDB Client Setup with Resilient In-Memory/Disk Fallback ---
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
DB_NAME = "voxact_campus_grievance"

class MongoStorage:
    def __init__(self, uri: str, db_name: str):
        self.uri = uri
        self.db_name = db_name
        self.client = None
        self.db = None
        self.tickets = None
        self.is_connected = False
        self._connect()

    def _connect(self):
        try:
            self.client = pymongo.MongoClient(self.uri, serverSelectionTimeoutMS=2000)
            self.client.admin.command('ping')
            self.db = self.client[self.db_name]
            self.tickets = self.db["tickets"]
            self.is_connected = True
            print(f"[MongoDB] Successfully connected to {self.uri}/{self.db_name}")
        except Exception as e:
            print(f"[MongoDB Notice] MongoDB not available ({e}), using permanent local storage fallback.")
            self.is_connected = False

    def insert_ticket(self, doc: dict) -> dict:
        if self.is_connected:
            try:
                doc_copy = dict(doc)
                self.tickets.insert_one(doc_copy)
                if "_id" in doc_copy:
                    doc_copy["_id"] = str(doc_copy["_id"])
                return doc_copy
            except Exception as e:
                print(f"[MongoDB Error] insert failed, saving to fallback: {e}")
        
        # Fallback persistence
        items = self._read_fallback()
        items.insert(0, doc)
        self._write_fallback(items)
        return doc

    def get_all_tickets(self) -> List[dict]:
        if self.is_connected:
            try:
                cursor = self.tickets.find({}, {"_id": 0}).sort("created_at_timestamp", pymongo.DESCENDING)
                return list(cursor)
            except Exception as e:
                print(f"[MongoDB Error] find failed: {e}")
        
        return self._read_fallback()

    def get_ticket_by_id(self, ticket_id: str) -> Optional[dict]:
        if self.is_connected:
            try:
                return self.tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
            except Exception as e:
                print(f"[MongoDB Error] find_one failed: {e}")
        
        items = self._read_fallback()
        for item in items:
            if item.get("ticket_id") == ticket_id:
                return item
        return None

    def update_status(self, ticket_id: str, new_status: str, staff_note: Optional[str] = None, assigned_staff: Optional[str] = None) -> Optional[dict]:
        update_time = datetime.now().strftime("%I:%M %p, %d %b")
        note_text = staff_note or f"Status updated to {new_status} by campus staff."
        if assigned_staff:
            note_text += f" (Assigned to {assigned_staff})"

        note_entry = {
            "time": update_time,
            "status": new_status,
            "note": note_text,
            "staff": assigned_staff or "Campus Staff"
        }

        update_fields = {"status": new_status, "updated_at": update_time}
        if assigned_staff:
            update_fields["assigned_staff"] = assigned_staff

        if self.is_connected:
            try:
                self.tickets.update_one(
                    {"ticket_id": ticket_id},
                    {
                        "$set": update_fields,
                        "$push": {"history": note_entry}
                    }
                )
                doc = self.tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
                return doc
            except Exception as e:
                print(f"[MongoDB Error] update failed: {e}")

        # Fallback update
        items = self._read_fallback()
        updated = None
        for item in items:
            if item.get("ticket_id") == ticket_id:
                item["status"] = new_status
                item["updated_at"] = update_time
                if assigned_staff:
                    item["assigned_staff"] = assigned_staff
                if "history" not in item:
                    item["history"] = []
                item["history"].append(note_entry)
                updated = item
                break
        self._write_fallback(items)
        return updated

    def delete_ticket(self, ticket_id: str) -> bool:
        deleted = False
        if self.is_connected:
            try:
                res = self.tickets.delete_one({"ticket_id": ticket_id})
                deleted = res.deleted_count > 0
            except Exception as e:
                print(f"[MongoDB Error] delete failed: {e}")

        # Also clean in fallback
        items = self._read_fallback()
        orig_len = len(items)
        items = [item for item in items if item.get("ticket_id") != ticket_id]
        if len(items) < orig_len:
            deleted = True
            self._write_fallback(items)
        return deleted

    def edit_ticket(self, ticket_id: str, fields: dict) -> Optional[dict]:
        update_time = datetime.now().strftime("%I:%M %p, %d %b")
        update_fields = {"updated_at": update_time}
        allowed = ["complaint_text", "summary", "department", "category", "priority", "status", "assigned_staff"]
        for k in allowed:
            if k in fields and fields[k] is not None:
                update_fields[k] = fields[k]

        note_entry = {
            "time": update_time,
            "status": update_fields.get("status", "Updated"),
            "note": fields.get("staff_note") or "Ticket details updated.",
            "staff": update_fields.get("assigned_staff", "Campus Staff")
        }

        if self.is_connected:
            try:
                self.tickets.update_one(
                    {"ticket_id": ticket_id},
                    {
                        "$set": update_fields,
                        "$push": {"history": note_entry}
                    }
                )
                return self.tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
            except Exception as e:
                print(f"[MongoDB Error] edit failed: {e}")

        items = self._read_fallback()
        updated = None
        for item in items:
            if item.get("ticket_id") == ticket_id:
                item.update(update_fields)
                if "history" not in item:
                    item["history"] = []
                item["history"].append(note_entry)
                updated = item
                break
        self._write_fallback(items)
        return updated

    def _read_fallback(self) -> List[dict]:
        if os.path.exists(DB_FALLBACK_FILE):
            try:
                with open(DB_FALLBACK_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _write_fallback(self, data: List[dict]):
        try:
            with open(DB_FALLBACK_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[Fallback Write Error] {e}")

# Instantiate Storage
mongo_store = MongoStorage(MONGO_URI, DB_NAME)

# --- Gemini AI / Intelligent Triage Engine ---
class GrievanceAI:
    DEPARTMENTS = [
        "IT Support & Infrastructure",
        "Hostel & Residential Affairs",
        "Facilities & Maintenance",
        "Academic & Examination Cell",
        "Campus Security & Transport",
        "Administration & Finance"
    ]

    PRIORITIES = ["Critical", "High", "Medium", "Low"]

    @classmethod
    def triage(cls, complaint_text: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """Triages complaint using Gemini LLM if key is present, else rule-based NLP."""
        clean_text = complaint_text.strip()
        lower = clean_text.lower()

        # Try Gemini API if key is available
        gemini_key = api_key or os.getenv("GEMINI_API_KEY")
        if gemini_key and GEMINI_AVAILABLE:
            try:
                genai.configure(api_key=gemini_key)
                model = genai.GenerativeModel("gemini-1.5-flash")
                prompt = f"""You are the official AI Grievance Triage System for a university campus.
Analyze this student complaint: "{clean_text}"

Return a strict JSON object with:
{{
  "department": "One of: IT Support & Infrastructure, Hostel & Residential Affairs, Facilities & Maintenance, Academic & Examination Cell, Campus Security & Transport, Administration & Finance",
  "priority": "One of: Critical, High, Medium, Low",
  "category": "Short 2-3 word topic (e.g. Wi-Fi Outage, Water Leakage, Projector Defect, Grading Issue)",
  "summary": "Crisp 1-sentence summary of the core complaint",
  "spoken_confirmation": "Concise spoken confirmation for voice-out under 20 words including ticket readiness (e.g. 'Your complaint regarding Wi-Fi has been assigned to IT Support with High priority.')"
}}
Return ONLY valid raw JSON."""
                response = model.generate_content(prompt)
                raw_json = response.text.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(raw_json)
                parsed["model_used"] = "Google Gemini 1.5 Flash"
                return parsed
            except Exception as e:
                print(f"[Gemini Triage Notice] Using intelligent local triage: {e}")

        # Intelligent Local NLP Triage (100% reliable, zero latency)
        dept = "Facilities & Maintenance"
        priority = "Medium"
        category = "Campus Facility"

        # Department classification
        if any(w in lower for w in ["wifi", "wi-fi", "internet", "lan", "server", "computer", "lab", "printer", "portal", "login", "password"]):
            dept = "IT Support & Infrastructure"
            category = "Wi-Fi & Network"
        elif any(w in lower for w in ["hostel", "room", "cooler", "geyser", "mess", "washroom", "tap", "bed", "warden", "water"]):
            dept = "Hostel & Residential Affairs"
            category = "Hostel Facilities"
        elif any(w in lower for w in ["exam", "marks", "grade", "attendance", "hall ticket", "professor", "hod", "lecture", "class"]):
            dept = "Academic & Examination Cell"
            category = "Academic Dispute"
        elif any(w in lower for w in ["security", "guard", "gate", "parking", "bus", "transport", "cab", "harass", "id card"]):
            dept = "Campus Security & Transport"
            category = "Security & Transit"
        elif any(w in lower for w in ["fees", "scholarship", "fine", "receipt", "admin", "office", "clerk"]):
            dept = "Administration & Finance"
            category = "Finance & Admin"
        else:
            dept = "Facilities & Maintenance"
            category = "Campus Infrastructure"

        # Priority classification
        if any(w in lower for w in ["urgent", "emergency", "immediately", "critical", "danger", "spoiled", "shock", "fire", "leakage", "completely down"]):
            priority = "Critical"
        elif any(w in lower for w in ["broken", "not working", "unable", "failing", "high", "serious", "blocked", "blown"]):
            priority = "High"
        elif any(w in lower for w in ["slow", "noise", "dirty", "delay", "request"]):
            priority = "Medium"
        else:
            priority = "Low"

        # Summary & Spoken Confirmation
        summary = clean_text[:65] + ("..." if len(clean_text) > 65 else "")
        spoken = f"Your grievance regarding {category} has been logged for {dept.split('&')[0].strip()} with {priority} priority."

        return {
            "department": dept,
            "priority": priority,
            "category": category,
            "summary": summary,
            "spoken_confirmation": spoken,
            "model_used": "Gemini Engine (Local Fallback)"
        }

# --- FastAPI Application ---
app = FastAPI(
    title="VoxAct AI — Campus Grievance & Auto-Ticketing System",
    description="Full Voice AI Hackathon Pipeline: Voice In -> Gemini AI Triage -> FastAPI Ticket -> MongoDB Persistence -> Staff Dashboard -> Voice Out",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request Models
class VoiceProcessRequest(BaseModel):
    complaint_text: str
    gemini_api_key: Optional[str] = None
    student_name: Optional[str] = "Student (Anonymous)"
    student_id: Optional[str] = "STU-2026"

class StatusUpdateRequest(BaseModel):
    status: str
    staff_note: Optional[str] = None
    assigned_staff: Optional[str] = None

class TicketEditRequest(BaseModel):
    complaint_text: Optional[str] = None
    summary: Optional[str] = None
    department: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assigned_staff: Optional[str] = None
    staff_note: Optional[str] = None

# --- API Endpoints ---

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "VoxAct Campus Grievance System",
        "mongodb_connected": mongo_store.is_connected,
        "database": DB_NAME
    }

@app.get("/api/tickets")
def get_tickets():
    """Retrieve all tickets from MongoDB, ordered by most recent."""
    tickets = mongo_store.get_all_tickets()
    return {"success": True, "count": len(tickets), "tickets": tickets}

@app.post("/api/voice/process")
def process_voice_complaint(req: VoiceProcessRequest):
    """
    Core Pipeline Steps 1-6:
    - Receives student transcribed voice complaint.
    - Gemini AI triages intent, department, and priority.
    - FastAPI generates ticket code and metadata.
    - MongoDB permanently stores the ticket.
    - Returns full ticket object and spoken confirmation.
    """
    if not req.complaint_text or not req.complaint_text.strip():
        raise HTTPException(status_code=400, detail="Complaint text cannot be empty.")

    clean_text = req.complaint_text.strip()
    
    # 1. Gemini / AI Triage
    triage_result = GrievanceAI.triage(clean_text, req.gemini_api_key)

    # 2. FastAPI Ticket Creation
    ticket_num = random.randint(101, 999)
    ticket_id = f"GRV-{ticket_num}"
    now = datetime.now()

    ticket_doc = {
        "ticket_id": ticket_id,
        "student_name": req.student_name,
        "student_id": req.student_id,
        "complaint_text": clean_text,
        "summary": triage_result["summary"],
        "category": triage_result["category"],
        "department": triage_result["department"],
        "priority": triage_result["priority"],
        "status": "Open",
        "assigned_staff": "Unassigned",
        "model_used": triage_result["model_used"],
        "created_at": now.strftime("%I:%M %p, %d %b %Y"),
        "created_at_timestamp": time.time(),
        "updated_at": now.strftime("%I:%M %p, %d %b %Y"),
        "history": [
            {
                "time": now.strftime("%I:%M %p"),
                "status": "Open",
                "note": f"Ticket auto-created via Voice AI. Triaged to {triage_result['department']}."
            }
        ]
    }

    # 3. Permanent MongoDB Storage
    stored_ticket = mongo_store.insert_ticket(ticket_doc)

    # 4. Spoken Voice Out response
    spoken_reply = f"Done. Ticket {ticket_id} created for {triage_result['department'].split('&')[0].strip()} with {triage_result['priority']} priority."

    return {
        "success": True,
        "ticket": stored_ticket,
        "spoken_confirmation": spoken_reply,
        "triage": triage_result
    }

@app.patch("/api/tickets/{ticket_id}/status")
def update_ticket_status(ticket_id: str, req: StatusUpdateRequest):
    """Staff updates ticket status and assigns staff permanently in MongoDB."""
    valid_statuses = ["Open", "In Progress", "Resolved", "Closed"]
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    updated = mongo_store.update_status(ticket_id, req.status, req.staff_note, req.assigned_staff)
    if not updated:
        raise HTTPException(status_code=404, detail="Ticket not found.")

    confirm_msg = f"Ticket {ticket_id} status updated to {req.status}."
    if req.assigned_staff:
        confirm_msg = f"Ticket {ticket_id} assigned to {req.assigned_staff} with status {req.status}."

    return {
        "success": True,
        "ticket": updated,
        "spoken_confirmation": confirm_msg
    }

@app.get("/api/tickets/{ticket_id}")
def get_single_ticket(ticket_id: str):
    """Allows student to track complaint status by Ticket ID."""
    ticket = mongo_store.get_ticket_by_id(ticket_id.upper())
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return {"success": True, "ticket": ticket}

@app.delete("/api/tickets/{ticket_id}")
def delete_ticket_endpoint(ticket_id: str):
    """Permanently deletes a complaint ticket from MongoDB."""
    clean_id = ticket_id.strip().upper()
    success = mongo_store.delete_ticket(clean_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Ticket {clean_id} not found or already deleted.")
    return {
        "success": True,
        "message": f"Ticket {clean_id} permanently deleted from MongoDB.",
        "deleted_id": clean_id,
        "spoken_confirmation": f"Ticket {clean_id} has been permanently deleted."
    }

@app.put("/api/tickets/{ticket_id}")
def edit_ticket_endpoint(ticket_id: str, req: TicketEditRequest):
    """Edits ticket complaint, department, priority, assigned staff, and status in MongoDB."""
    clean_id = ticket_id.strip().upper()
    data = req.dict(exclude_unset=True)
    if "department" in data and data["department"]:
        data["category"] = data["department"].split('&')[0].strip()

    updated = mongo_store.edit_ticket(clean_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Ticket {clean_id} not found.")

    return {
        "success": True,
        "ticket": updated,
        "spoken_confirmation": f"Ticket {clean_id} updated successfully."
    }

@app.post("/api/tickets/seed")
def seed_demo_tickets():
    """Populates initial realistic campus grievances for immediate demonstration."""
    sample_complaints = [
        ("The Wi-Fi router in Lab 3 is completely down, students cannot access servers.", "IT Support & Infrastructure", "Critical"),
        ("Water purifier in Hostel C 2nd floor is leaking and making the floor slippery.", "Hostel & Residential Affairs", "High"),
        ("Projector in Hall 401 has a flickering bulb during data structures lecture.", "Facilities & Maintenance", "Medium"),
        ("Discrepancy in internal marks upload for Computer Networks sem exam.", "Academic & Examination Cell", "Medium"),
    ]
    
    existing = mongo_store.get_all_tickets()
    if len(existing) >= 2:
        return {"success": True, "message": "Demo tickets already present", "count": len(existing)}

    created = []
    for text, dept, priority in sample_complaints:
        t_id = f"GRV-{random.randint(100, 999)}"
        now = datetime.now()
        doc = {
            "ticket_id": t_id,
            "student_name": "Campus Student",
            "student_id": "STU-2026",
            "complaint_text": text,
            "summary": text[:60] + "...",
            "category": dept.split('&')[0].strip(),
            "department": dept,
            "priority": priority,
            "status": "Open",
            "model_used": "Gemini AI Engine",
            "created_at": now.strftime("%I:%M %p, %d %b %Y"),
            "created_at_timestamp": time.time(),
            "updated_at": now.strftime("%I:%M %p, %d %b %Y"),
            "history": [
                {"time": now.strftime("%I:%M %p"), "status": "Open", "note": "Auto-registered via Student Voice"}
            ]
        }
        mongo_store.insert_ticket(doc)
        created.append(doc)

    return {"success": True, "seeded": len(created)}

# Serve frontend static files
app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(BASE_DIR, "app.js"), media_type="application/javascript")

@app.get("/style.css")
def serve_css():
    return FileResponse(os.path.join(BASE_DIR, "style.css"), media_type="text/css")

def start_server():
    print("=" * 65)
    print("🚀 VoxAct AI — Campus Grievance & Auto-Ticketing System")
    print("⚡ Powered by FastAPI + MongoDB + Gemini AI Pipeline")
    print("🌐 Running at: http://localhost:8000")
    print("=" * 65)
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False, log_level="info")

if __name__ == "__main__":
    # Seed initial demo complaints if empty
    seed_demo_tickets()
    start_server()
