# VoxAct AI 🎙️
### Campus Voice Grievance & Intelligent Ticket Management

**Speak Your Problem. AI Takes Action.**

VoiceDesk AI is an AI-powered campus grievance management system that allows students to report campus-related issues using voice commands. The application uses speech recognition and Google's Gemini AI to understand complaints, identify their categories, determine priority levels, and generate structured support tickets.

It provides a centralized dashboard where administrative staff can review complaints, manage tickets, assign departments, and track resolution progress.

---

## 📌 Problem Statement

Traditional campus grievance systems often require students to submit complaints through lengthy forms or visit administrative offices. This process can be inconvenient, time-consuming, and difficult to track.

Additionally, managing multiple complaints manually can make it challenging for staff to identify urgent issues and organize requests efficiently.

## 💡 Our Solution

VoiceDesk AI simplifies the grievance process through voice-based interaction and AI-powered complaint classification.

Students can simply speak about their problems. The system converts speech into text, analyzes the complaint using Gemini AI, and automatically generates a structured support ticket.

Staff can then manage and resolve complaints through an administrative dashboard.

## ✨ Key Features

### 🎤 1. Voice-Based Complaint Registration
- Register complaints using voice input.
- Convert speech into text using the Web Speech API.
- Display the recognized complaint before submission.
- Provide an option to edit the recognized text.

### 🧠 2. Gemini AI Complaint Analysis
- Understand natural-language complaints.
- Automatically classify complaints into categories.
- Identify complaint priority.
- Generate concise complaint summaries.
- Suggest the appropriate department.

### 🎫 3. Intelligent Ticket Generation
- Generate unique ticket IDs.
- Store original complaints and AI-generated summaries.
- Record complaint categories, priorities, and locations.
- Maintain complaint creation timestamps.

### 🖥️ 4. Student Dashboard
- Submit voice complaints.
- View generated ticket details.
- Track complaint status.
- View previously submitted complaints.

### ⚙️ 5. Staff/Admin Dashboard
- View all registered complaints.
- Filter tickets by category, priority, and status.
- Assign complaints to relevant departments.
- Update complaint progress.
- Monitor pending, ongoing, and resolved tickets.

### 🔊 6. Voice Response
- Provide spoken confirmation after complaint registration.
- Read out ticket information.
- Announce complaint status updates.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | UI design and styling |
| JavaScript | Frontend functionality |
| Web Speech API | Speech recognition |
| Gemini API | AI complaint analysis |
| Python Flask | Backend development |
| SQLite | Database management |
| SpeechSynthesis API | Voice responses |
| Git & GitHub | Version control |

## 🔄 Application Workflow

1. Student opens the VoiceDesk AI application.
2. Student clicks the microphone button.
3. Student describes the campus issue.
4. Speech recognition converts the voice into text.
5. Gemini AI analyzes the complaint.
6. The system identifies category, priority, location, and department.
7. Backend generates a unique ticket ID and stores the complaint.
8. The complaint appears on the staff dashboard.
9. Staff updates the ticket status.
10. Student receives a status update through the application.

## 🏷️ Complaint Categories

The application supports campus-related complaint categories such as:

- Water Supply
- Electricity
- Classroom Maintenance
- Hostel Facilities
- Washroom Maintenance
- Internet and Wi-Fi
- Transportation
- Other Campus Issues

## 🚦 Complaint Priority Levels

| Priority | Description |
|---|---|
| Critical | Urgent issues requiring immediate attention |
| High | Serious issues requiring quick action |
| Medium | Issues requiring timely attention |
| Low | General issues that can be addressed normally |

## 📊 Ticket Status Management

The application follows this ticket lifecycle:

**New → In Progress → Resolved**

Each ticket maintains its current status so students and staff can track complaint progress.

## 🗂️ Project Structure

```text
VoiceDesk-AI/
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── backend/
│   ├── app.py
│   ├── database.py
│   └── gemini.py
│
├── .env
├── .gitignore
├── requirements.txt
└── README.md
```

## ⚙️ Installation and Setup

### Prerequisites

- Python 3.10 or later
- Visual Studio Code
- Modern web browser with microphone support
- Gemini API key

### Step 1: Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd VoiceDesk-AI
```

### Step 2: Create a Virtual Environment

```bash
python -m venv venv
```

Activate it on Windows:

```powershell
venv\Scripts\activate
```

### Step 3: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables

Create a `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Never upload your actual API key to GitHub.

### Step 5: Run the Application

```bash
python backend/app.py
```

Open the local application URL displayed by Flask in your browser.

## 🔐 Security Considerations

- Store API credentials in environment variables.
- Never expose API keys in frontend JavaScript.
- Validate user input before processing.
- Restrict administrative actions to authorized staff.
- Protect student information and complaint records.

## 🚀 Future Enhancements

- Multilingual voice recognition, including regional languages.
- Duplicate complaint detection.
- AI-based complaint trend analysis.
- Real-time ticket notifications.
- Department-wise complaint analytics.
- Mobile-friendly application support.
- Voice-based complaint status tracking.

## 🎯 Project Objective

The primary objective of VoiceDesk AI is to make campus grievance reporting more accessible, efficient, and organized through voice interaction, artificial intelligence, and centralized ticket management.

## 👩‍💻 Developed By

**Project:** VoiceDesk AI  
**Domain:** Artificial Intelligence | Voice AI | Full-Stack Development  
**Purpose:** AI-powered Campus Grievance Management

---

**VoiceDesk AI – Speak Your Problem. AI Takes Action.**
