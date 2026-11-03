/**
 * VoxAct AI — Campus Voice Grievance & Auto-Ticketing System
 * Color Palette:
 * - Sidebar / Dark Background: #202638
 * - Primary Accent / Buttons: #F07864
 * - Light Background: #FFF9F5
 * - Cards: #FFFFFF
 * - Text: #34394A
 * - Soft Coral: #FCE9E3
 */

(function () {
  'use strict';

  const API_BASE = window.location.origin;

  const state = {
    activeTab: 'student', // 'student' | 'staff'
    tickets: [],
    studentTickets: JSON.parse(localStorage.getItem('voxact_student_tickets') || '[]'),
    isListening: false,
    settings: {
      geminiApiKey: localStorage.getItem('voxact_gemini_key') || '',
      voiceName: localStorage.getItem('voxact_voice_name') || '',
      soundMuted: false,
    },
    audioContext: null,
    analyser: null,
    mediaStream: null,
    lastVoiceResponse: '',
    selectedTicketForStaff: null,
    selectedTicketForEdit: null,
    selectedTicketForDelete: null,
  };

  // --- Initial Seed for Student Portal if Empty ---
  function ensureStudentInitialSeed() {
    if (!state.studentTickets || state.studentTickets.length === 0) {
      state.studentTickets = [
        {
          ticket_id: 'GRV-789',
          department: 'IT Support & Infrastructure',
          priority: 'Critical',
          status: 'Resolved',
          summary: 'Wi-Fi router in Lab 3 down; gigabit switch replaced.',
          assigned_staff: 'Vikram (IT Network Engineer)',
          created_at: '09:30 AM, Today'
        },
        {
          ticket_id: 'GRV-439',
          department: 'Hostel & Residential Affairs',
          priority: 'High',
          status: 'Resolved',
          summary: 'Water purifier in Hostel C 2nd floor pipe replaced.',
          assigned_staff: 'Ramesh (Plumbing & Sanitation)',
          created_at: '11:15 AM, Today'
        },
        {
          ticket_id: 'GRV-360',
          department: 'Campus Security & Transport',
          priority: 'High',
          status: 'In Progress',
          summary: 'Street lights near Gate 3 fuse replaced, testing phase lines.',
          assigned_staff: 'Suresh (Campus Electrician)',
          created_at: '01:40 PM, Today'
        },
        {
          ticket_id: 'GRV-742',
          department: 'Hostel & Residential Affairs',
          priority: 'Medium',
          status: 'Open',
          summary: 'Hostel D hot water geyser not turning on in morning.',
          assigned_staff: 'Hostel Warden Office',
          created_at: '02:10 PM, Today'
        }
      ];
      localStorage.setItem('voxact_student_tickets', JSON.stringify(state.studentTickets));
    }
  }

  // --- Sound Effects (Web Audio API) ---
  const AudioFX = {
    ctx: null,
    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },
    playTone(freq, type = 'sine', duration = 0.12, gainVal = 0.08) {
      if (state.settings.soundMuted) return;
      try {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {}
    },
    listeningStart() {
      this.playTone(587.33, 'sine', 0.1, 0.06);
      setTimeout(() => this.playTone(880, 'sine', 0.18, 0.08), 80);
    },
    listeningEnd() {
      this.playTone(659.25, 'sine', 0.1, 0.05);
      setTimeout(() => this.playTone(440, 'sine', 0.15, 0.05), 80);
    },
    actionSuccess() {
      this.playTone(523.25, 'triangle', 0.2, 0.06);
      setTimeout(() => this.playTone(659.25, 'triangle', 0.22, 0.06), 90);
      setTimeout(() => this.playTone(783.99, 'triangle', 0.35, 0.08), 180);
    },
    actionDelete() {
      this.playTone(320, 'sawtooth', 0.15, 0.06);
      setTimeout(() => this.playTone(210, 'sawtooth', 0.2, 0.07), 100);
    }
  };

  // --- Audio Waveform Visualizer ---
  const Visualizer = {
    canvas: null,
    ctx: null,
    animationFrameId: null,
    dataArray: null,
    init() {
      this.canvas = document.getElementById('visualizerCanvas');
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d');
        this.drawIdle();
      }
    },
    drawIdle() {
      if (!this.canvas || !this.ctx) return;
      const { width, height } = this.canvas;
      this.ctx.clearRect(0, 0, width, height);

      const time = Date.now() * 0.002;
      this.ctx.beginPath();
      this.ctx.strokeStyle = '#F07864';
      this.ctx.lineWidth = 2.2;

      for (let x = 0; x < width; x += 3) {
        const y = height / 2 + Math.sin(x * 0.04 + time) * 4 * Math.sin(x * 0.01 + time * 0.5);
        if (x === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      if (!state.isListening) {
        this.animationFrameId = requestAnimationFrame(() => this.drawIdle());
      }
    },
    startMicStream(stream) {
      try {
        if (!state.audioContext) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          state.audioContext = new AudioCtx();
        }
        if (state.audioContext.state === 'suspended') {
          state.audioContext.resume();
        }
        const source = state.audioContext.createMediaStreamSource(stream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 64;
        source.connect(state.analyser);

        const bufferLength = state.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);
        this.drawActiveWave();
      } catch (err) {
        console.warn('Audio Visualizer fallback:', err);
      }
    },
    drawActiveWave() {
      if (!state.isListening || !this.canvas || !this.ctx || !state.analyser) return;

      this.animationFrameId = requestAnimationFrame(() => this.drawActiveWave());
      state.analyser.getByteFrequencyData(this.dataArray);

      const { width, height } = this.canvas;
      this.ctx.clearRect(0, 0, width, height);

      const barWidth = (width / this.dataArray.length) * 1.5;
      let x = 0;

      for (let i = 0; i < this.dataArray.length; i++) {
        const barHeight = (this.dataArray[i] / 255) * (height * 0.85);

        const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#FCE9E3');
        gradient.addColorStop(0.5, '#F07864');
        gradient.addColorStop(1, '#e0624d');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, height / 2 - barHeight / 2, barWidth - 2, Math.max(3, barHeight));
        x += barWidth;
      }
    },
    stop() {
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.drawIdle();
    }
  };

  // --- Step 1 & 2: Voice Input (Web Speech API) ---
  const VoiceInput = {
    recognition: null,
    isSupported: false,

    init() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.isSupported = true;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
          state.isListening = true;
          UI.setListeningState(true);
          AudioFX.listeningStart();
        };

        this.recognition.onresult = (event) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (interimTranscript) {
            UI.setTranscript(interimTranscript, true);
          }
          if (finalTranscript) {
            UI.setTranscript(finalTranscript, false);
            this.handleFinalSpeech(finalTranscript);
          }
        };

        this.recognition.onerror = (event) => {
          console.warn('Speech recognition error:', event.error);
          state.isListening = false;
          UI.setListeningState(false);
          let msg = `Microphone issue: ${event.error}`;
          if (event.error === 'not-allowed') {
            msg = 'Microphone permission denied. Enable microphone access in browser settings.';
          } else if (event.error === 'no-speech') {
            msg = 'No speech detected. Click Speak or tap Spacebar to try again.';
          }
          UI.setStatus(msg, 'warning');
        };

        this.recognition.onend = () => {
          state.isListening = false;
          UI.setListeningState(false);
          AudioFX.listeningEnd();
        };
      } else {
        UI.setStatus('Speech recognition not supported in this browser. Please type complaint in the box below.', 'warning');
      }
    },

    toggle() {
      if (state.isListening) {
        this.stop();
      } else {
        this.start();
      }
    },

    start() {
      if (!this.isSupported) {
        UI.setStatus('Microphone recognition not supported in this browser. Use text box below.', 'warning');
        return;
      }
      try {
        this.recognition.start();
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
              state.mediaStream = stream;
              Visualizer.startMicStream(stream);
            })
            .catch(() => {});
        }
      } catch (e) {}
    },

    stop() {
      if (this.recognition && state.isListening) {
        try { this.recognition.stop(); } catch (e) {}
      }
      state.isListening = false;
      UI.setListeningState(false);
      Visualizer.stop();
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(t => t.stop());
        state.mediaStream = null;
      }
    },

    async handleFinalSpeech(text) {
      if (!text) return;
      this.stop();
      await Pipeline.submitComplaint(text);
    }
  };

  // --- Step 9: Voice Out (SpeechSynthesis) ---
  const VoiceOutput = {
    voices: [],
    init() {
      if ('speechSynthesis' in window) {
        const load = () => {
          this.voices = window.speechSynthesis.getVoices();
          UI.populateVoiceSelect(this.voices);
        };
        load();
        window.speechSynthesis.onvoiceschanged = load;
      }
    },
    speak(text) {
      if (!('speechSynthesis' in window)) return;
      if (state.settings.soundMuted) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      if (state.settings.voiceName) {
        const found = this.voices.find(v => v.name === state.settings.voiceName);
        if (found) utterance.voice = found;
      } else {
        const natural = this.voices.find(v => (v.name.includes('Natural') || v.name.includes('Google') || v.lang.startsWith('en')) && !v.name.includes('eSpeak'));
        if (natural) utterance.voice = natural;
      }

      window.speechSynthesis.speak(utterance);
    }
  };

  // --- Pipeline Controller (FastAPI & MongoDB Integration) ---
  const Pipeline = {
    async submitComplaint(complaintText) {
      if (!complaintText || !complaintText.trim()) return;
      const text = complaintText.trim();

      UI.setTranscript(text, false);
      UI.setStatus('Gemini AI identifying complaint & determining department & priority...', 'processing');

      try {
        const res = await fetch(`${API_BASE}/api/voice/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            complaint_text: text,
            gemini_api_key: state.settings.geminiApiKey || null,
            student_name: 'Campus Student',
            student_id: 'STU-' + Math.floor(1000 + Math.random() * 9000)
          })
        });

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const data = await res.json();
        const ticket = data.ticket;
        const spokenReply = data.spoken_confirmation;

        // Add to global state
        state.tickets.unshift(ticket);

        // Save into Student's local recent complaints
        this.saveStudentTicket(ticket);

        // Display ticket in Student Dashboard Success Card
        UI.showStudentTicketSuccess(ticket);

        // Play Voice Out response
        UI.showVoiceOut(spokenReply);
        VoiceOutput.speak(spokenReply);
        AudioFX.actionSuccess();
        UI.setStatus(`Ticket ${ticket.ticket_id} created in MongoDB for ${ticket.department}`, 'ready');

        // Update staff dashboard views in background
        UI.renderTickets();
        UI.updateStats();

      } catch (err) {
        console.error('Pipeline error:', err);
        UI.setStatus('Failed to communicate with FastAPI / MongoDB backend.', 'warning');
      }
    },

    saveStudentTicket(ticket) {
      state.studentTickets = state.studentTickets.filter(t => t.ticket_id !== ticket.ticket_id);
      state.studentTickets.unshift({
        ticket_id: ticket.ticket_id,
        department: ticket.department,
        priority: ticket.priority,
        status: ticket.status,
        summary: ticket.summary || ticket.complaint_text,
        assigned_staff: ticket.assigned_staff || 'Unassigned',
        created_at: ticket.created_at || 'Just now'
      });
      localStorage.setItem('voxact_student_tickets', JSON.stringify(state.studentTickets.slice(0, 20)));
      UI.renderStudentRecentTickets();
    },

    async fetchAllTickets() {
      try {
        const res = await fetch(`${API_BASE}/api/tickets`);
        if (res.ok) {
          const data = await res.json();
          if (data.tickets) {
            state.tickets = data.tickets;
            UI.renderTickets();
            UI.updateStats();
            this.syncStudentTicketStatuses();
          }
        }
      } catch (err) {
        console.warn('Could not fetch tickets from MongoDB:', err);
      }
    },

    syncStudentTicketStatuses() {
      let modified = false;
      state.studentTickets.forEach(st => {
        const match = state.tickets.find(t => t.ticket_id === st.ticket_id);
        if (match) {
          if (st.status !== match.status || st.assigned_staff !== match.assigned_staff || st.priority !== match.priority || st.summary !== match.summary) {
            st.status = match.status;
            st.assigned_staff = match.assigned_staff || 'Unassigned';
            st.priority = match.priority;
            st.summary = match.summary || match.complaint_text;
            modified = true;
          }
        }
      });
      if (modified) {
        localStorage.setItem('voxact_student_tickets', JSON.stringify(state.studentTickets));
        UI.renderStudentRecentTickets();
      }
    },

    async fetchSingleTicket(ticketId) {
      try {
        const cleanId = ticketId.trim().toUpperCase();
        const res = await fetch(`${API_BASE}/api/tickets/${cleanId}`);
        if (!res.ok) {
          return null;
        }
        const data = await res.json();
        return data.ticket;
      } catch (err) {
        console.error('Error fetching ticket:', err);
        return null;
      }
    },

    async updateTicketStatus(ticketId, newStatus, staffNote = '', assignedStaff = '') {
      try {
        UI.setStatus(`Updating ticket ${ticketId} in MongoDB...`, 'processing');

        const payload = {
          status: newStatus,
          staff_note: staffNote || undefined,
          assigned_staff: assignedStaff || undefined
        };

        const res = await fetch(`${API_BASE}/api/tickets/${ticketId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`Update failed: ${res.status}`);
        }

        const data = await res.json();
        const updatedTicket = data.ticket;

        // Update local tickets list
        const idx = state.tickets.findIndex(t => t.ticket_id === ticketId);
        if (idx !== -1) {
          state.tickets[idx] = updatedTicket;
        } else {
          state.tickets.unshift(updatedTicket);
        }

        // Sync student tickets if this ticket was submitted by student
        const sIdx = state.studentTickets.findIndex(t => t.ticket_id === ticketId);
        if (sIdx !== -1) {
          state.studentTickets[sIdx].status = updatedTicket.status;
          state.studentTickets[sIdx].assigned_staff = updatedTicket.assigned_staff || 'Unassigned';
          localStorage.setItem('voxact_student_tickets', JSON.stringify(state.studentTickets));
          UI.renderStudentRecentTickets();
        }

        // If the trackResultContainer is currently showing this ticket, re-render it
        const curTrackId = document.getElementById('trackInputTicketId');
        if (curTrackId && curTrackId.value.trim().toUpperCase() === ticketId) {
          UI.renderTrackResult(updatedTicket);
        }

        UI.renderTickets();
        UI.updateStats();
        AudioFX.actionSuccess();
        UI.setStatus(`Ticket ${ticketId} status updated to "${newStatus}" in MongoDB`, 'ready');

        if (data.spoken_confirmation) {
          VoiceOutput.speak(data.spoken_confirmation);
        }

      } catch (err) {
        console.error('Status update error:', err);
        UI.setStatus(`Failed to update ticket status: ${err.message}`, 'warning');
      }
    },

    async editTicket(ticketId, updateData) {
      try {
        UI.setStatus(`Saving edits for ticket ${ticketId} in MongoDB...`, 'processing');

        const res = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData)
        });

        if (!res.ok) {
          throw new Error(`Edit failed: ${res.status}`);
        }

        const data = await res.json();
        const updatedTicket = data.ticket;

        // Update global state
        const idx = state.tickets.findIndex(t => t.ticket_id === ticketId);
        if (idx !== -1) {
          state.tickets[idx] = updatedTicket;
        }

        // Update student tickets
        const sIdx = state.studentTickets.findIndex(t => t.ticket_id === ticketId);
        if (sIdx !== -1) {
          state.studentTickets[sIdx].department = updatedTicket.department;
          state.studentTickets[sIdx].priority = updatedTicket.priority;
          state.studentTickets[sIdx].status = updatedTicket.status;
          state.studentTickets[sIdx].summary = updatedTicket.summary || updatedTicket.complaint_text;
          state.studentTickets[sIdx].assigned_staff = updatedTicket.assigned_staff || 'Unassigned';
          localStorage.setItem('voxact_student_tickets', JSON.stringify(state.studentTickets));
          UI.renderStudentRecentTickets();
        }

        // Re-render tracker if open
        const curTrackId = document.getElementById('trackInputTicketId');
        if (curTrackId && curTrackId.value.trim().toUpperCase() === ticketId) {
          UI.renderTrackResult(updatedTicket);
        }

        UI.renderTickets();
        UI.updateStats();
        AudioFX.actionSuccess();
        UI.setStatus(`Ticket ${ticketId} details updated in MongoDB`, 'ready');

        if (data.spoken_confirmation) {
          VoiceOutput.speak(data.spoken_confirmation);
        }

      } catch (err) {
        console.error('Edit error:', err);
        UI.setStatus(`Failed to edit ticket: ${err.message}`, 'warning');
      }
    },

    async deleteTicket(ticketId) {
      try {
        UI.setStatus(`Deleting ticket ${ticketId} from MongoDB...`, 'processing');

        const res = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
          method: 'DELETE'
        });

        if (!res.ok) {
          throw new Error(`Delete failed: ${res.status}`);
        }

        // Remove from global list
        state.tickets = state.tickets.filter(t => t.ticket_id !== ticketId);

        // Remove from student tickets
        state.studentTickets = state.studentTickets.filter(t => t.ticket_id !== ticketId);
        localStorage.setItem('voxact_student_tickets', JSON.stringify(state.studentTickets));

        // Clear tracking container if it was showing deleted ticket
        const curTrackId = document.getElementById('trackInputTicketId');
        if (curTrackId && curTrackId.value.trim().toUpperCase() === ticketId) {
          document.getElementById('trackResultContainer').classList.add('hidden');
          curTrackId.value = '';
        }

        UI.renderStudentRecentTickets();
        UI.renderTickets();
        UI.updateStats();
        AudioFX.actionDelete();
        UI.setStatus(`Ticket ${ticketId} deleted permanently from MongoDB`, 'ready');

      } catch (err) {
        console.error('Delete error:', err);
        UI.setStatus(`Failed to delete ticket: ${err.message}`, 'warning');
      }
    }
  };

  // --- UI Controller ---
  const UI = {
    elements: {},

    init() {
      this.elements = {
        // Navigation Tabs
        navStudentTab: document.getElementById('navStudentTab'),
        navStaffTab: document.getElementById('navStaffTab'),
        studentDashboardView: document.getElementById('studentDashboardView'),
        staffDashboardView: document.getElementById('staffDashboardView'),

        // Voice Console
        micBtn: document.getElementById('micBtn'),
        micIcon: document.getElementById('micIcon'),
        micLabel: document.getElementById('micLabel'),
        micPulseRing: document.getElementById('micPulseRing'),
        orbGlow: document.getElementById('orbGlow'),
        statusBadge: document.getElementById('statusBadge'),
        statusDot: document.getElementById('statusDot'),
        statusText: document.getElementById('statusText'),
        liveTranscript: document.getElementById('liveTranscript'),
        copyTranscriptBtn: document.getElementById('copyTranscriptBtn'),
        voiceOutCard: document.getElementById('voiceOutCard'),
        voiceOutText: document.getElementById('voiceOutText'),
        replayVoiceBtn: document.getElementById('replayVoiceBtn'),
        textSubmitForm: document.getElementById('textSubmitForm'),
        manualInput: document.getElementById('manualInput'),

        // Student Ticket Success Card
        studentTicketSuccessCard: document.getElementById('studentTicketSuccessCard'),
        successTicketId: document.getElementById('successTicketId'),
        copyTicketIdBtn: document.getElementById('copyTicketIdBtn'),
        successDeptBadge: document.getElementById('successDeptBadge'),
        successPriorityBadge: document.getElementById('successPriorityBadge'),
        successAiSummary: document.getElementById('successAiSummary'),
        successStatusBadge: document.getElementById('successStatusBadge'),
        successAssignedStaff: document.getElementById('successAssignedStaff'),

        // Student Tracking
        trackLookupForm: document.getElementById('trackLookupForm'),
        trackInputTicketId: document.getElementById('trackInputTicketId'),
        trackResultContainer: document.getElementById('trackResultContainer'),
        studentRecentTicketsList: document.getElementById('studentRecentTicketsList'),

        // Staff Dashboard Controls & Stats
        statTotalTickets: document.getElementById('statTotalTickets'),
        statOpenTickets: document.getElementById('statOpenTickets'),
        statProgressTickets: document.getElementById('statProgressTickets'),
        statResolvedTickets: document.getElementById('statResolvedTickets'),
        ticketCountLabel: document.getElementById('ticketCountLabel'),
        ticketsGrid: document.getElementById('ticketsGrid'),
        filterDepartment: document.getElementById('filterDepartment'),
        filterPriority: document.getElementById('filterPriority'),
        filterStatus: document.getElementById('filterStatus'),
        ticketSearchInput: document.getElementById('ticketSearchInput'),
        refreshTicketsBtn: document.getElementById('refreshTicketsBtn'),
        exportPdfBtn: document.getElementById('exportPdfBtn'),
        exportCsvBtn: document.getElementById('exportCsvBtn'),
        deptProgressBar: document.getElementById('deptProgressBar'),
        resolutionRateBadge: document.getElementById('resolutionRateBadge'),

        // Staff Triage Modal
        staffModal: document.getElementById('staffModal'),
        closeStaffModal: document.getElementById('closeStaffModal'),
        modalTicketId: document.getElementById('modalTicketId'),
        modalTicketComplaint: document.getElementById('modalTicketComplaint'),
        modalStaffPresetSelect: document.getElementById('modalStaffPresetSelect'),
        modalStaffCustomInput: document.getElementById('modalStaffCustomInput'),
        modalStatusSelect: document.getElementById('modalStatusSelect'),
        modalStaffNote: document.getElementById('modalStaffNote'),
        saveStaffStatusBtn: document.getElementById('saveStaffStatusBtn'),

        // Edit Ticket Modal
        editTicketModal: document.getElementById('editTicketModal'),
        closeEditModalBtn: document.getElementById('closeEditModalBtn'),
        cancelEditBtn: document.getElementById('cancelEditBtn'),
        saveEditTicketBtn: document.getElementById('saveEditTicketBtn'),
        editModalTicketId: document.getElementById('editModalTicketId'),
        editComplaintText: document.getElementById('editComplaintText'),
        editSummaryText: document.getElementById('editSummaryText'),
        editDepartmentSelect: document.getElementById('editDepartmentSelect'),
        editPrioritySelect: document.getElementById('editPrioritySelect'),
        editStatusSelect: document.getElementById('editStatusSelect'),
        editStaffPresetSelect: document.getElementById('editStaffPresetSelect'),
        editStaffCustomInput: document.getElementById('editStaffCustomInput'),
        editNoteInput: document.getElementById('editNoteInput'),

        // Delete Confirmation Modal
        deleteConfirmModal: document.getElementById('deleteConfirmModal'),
        cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
        confirmDeleteTicketBtn: document.getElementById('confirmDeleteTicketBtn'),
        deleteModalTicketId: document.getElementById('deleteModalTicketId'),
        deleteModalComplaintPreview: document.getElementById('deleteModalComplaintPreview'),

        // Settings Modal
        settingsBtn: document.getElementById('settingsBtn'),
        settingsModal: document.getElementById('settingsModal'),
        closeSettingsModal: document.getElementById('closeSettingsModal'),
        geminiApiKey: document.getElementById('geminiApiKey'),
        ttsVoiceSelect: document.getElementById('ttsVoiceSelect'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        soundToggleBtn: document.getElementById('soundToggleBtn'),
        soundIcon: document.getElementById('soundIcon'),
      };

      ensureStudentInitialSeed();
      this.setupEventListeners();
      this.renderStudentRecentTickets();
      Pipeline.fetchAllTickets();
    },

    setupEventListeners() {
      // --- Portal Tab Switching ---
      if (this.elements.navStudentTab) {
        this.elements.navStudentTab.addEventListener('click', () => this.switchTab('student'));
      }
      if (this.elements.navStaffTab) {
        this.elements.navStaffTab.addEventListener('click', () => this.switchTab('staff'));
      }

      // --- Microphone toggle ---
      this.elements.micBtn.addEventListener('click', () => VoiceInput.toggle());

      // --- Spacebar Push-To-Talk ---
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          e.preventDefault();
          VoiceInput.toggle();
        }
      });

      // --- Quick Complaint Chips ---
      document.querySelectorAll('.quick-complaint-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = btn.getAttribute('data-text');
          Pipeline.submitComplaint(text);
        });
      });

      // --- Manual text submission form ---
      this.elements.textSubmitForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = this.elements.manualInput.value;
        if (val.trim()) {
          Pipeline.submitComplaint(val.trim());
          this.elements.manualInput.value = '';
        }
      });

      // --- Copy Converted Speech Text ---
      if (this.elements.copyTranscriptBtn) {
        this.elements.copyTranscriptBtn.addEventListener('click', () => {
          const text = this.elements.liveTranscript.textContent.replace(/^"|"$/g, '').trim();
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            UI.setStatus('Speech text copied to clipboard', 'ready');
          }
        });
      }

      // --- Replay Voice Out ---
      if (this.elements.replayVoiceBtn) {
        this.elements.replayVoiceBtn.addEventListener('click', () => {
          if (state.lastVoiceResponse) {
            VoiceOutput.speak(state.lastVoiceResponse);
          }
        });
      }

      // --- Copy Ticket ID Button in Success Card ---
      if (this.elements.copyTicketIdBtn) {
        this.elements.copyTicketIdBtn.addEventListener('click', () => {
          const ticketId = this.elements.successTicketId.textContent.trim();
          if (ticketId && navigator.clipboard) {
            navigator.clipboard.writeText(ticketId);
            UI.setStatus(`Ticket ID ${ticketId} copied to clipboard!`, 'ready');
          }
        });
      }

      // --- Student Track Complaint Lookup Form ---
      if (this.elements.trackLookupForm) {
        this.elements.trackLookupForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          let ticketId = this.elements.trackInputTicketId.value.trim().toUpperCase();
          if (!ticketId) return;
          if (!ticketId.startsWith('GRV-')) {
            ticketId = `GRV-${ticketId}`;
            this.elements.trackInputTicketId.value = ticketId;
          }

          UI.setStatus(`Looking up ticket ${ticketId} in MongoDB...`, 'processing');
          const ticket = await Pipeline.fetchSingleTicket(ticketId);
          if (ticket) {
            UI.renderTrackResult(ticket);
            UI.setStatus(`Status found for Ticket ${ticketId}`, 'ready');
          } else {
            UI.renderTrackNotFound(ticketId);
            UI.setStatus(`Ticket ${ticketId} not found in MongoDB`, 'warning');
          }
        });
      }

      // --- Staff Refresh & Exports ---
      if (this.elements.refreshTicketsBtn) {
        this.elements.refreshTicketsBtn.addEventListener('click', () => {
          Pipeline.fetchAllTickets();
          UI.setStatus('Refreshed latest tickets from MongoDB', 'ready');
        });
      }
      if (this.elements.exportPdfBtn) {
        this.elements.exportPdfBtn.addEventListener('click', () => this.exportPdf());
      }
      if (this.elements.exportCsvBtn) {
        this.elements.exportCsvBtn.addEventListener('click', () => this.exportCsv());
      }

      // --- Staff Filters & Search ---
      if (this.elements.filterDepartment) {
        this.elements.filterDepartment.addEventListener('change', () => this.renderTickets());
      }
      if (this.elements.filterPriority) {
        this.elements.filterPriority.addEventListener('change', () => this.renderTickets());
      }
      if (this.elements.filterStatus) {
        this.elements.filterStatus.addEventListener('change', () => this.renderTickets());
      }
      if (this.elements.ticketSearchInput) {
        this.elements.ticketSearchInput.addEventListener('input', () => this.renderTickets());
      }

      // --- Staff Triage Modal Handlers ---
      if (this.elements.closeStaffModal) {
        this.elements.closeStaffModal.addEventListener('click', () => this.closeModal(this.elements.staffModal));
      }
      if (this.elements.saveStaffStatusBtn) {
        this.elements.saveStaffStatusBtn.addEventListener('click', () => {
          if (!state.selectedTicketForStaff) return;
          const newStatus = this.elements.modalStatusSelect.value;
          const note = this.elements.modalStaffNote.value.trim();
          const assignedStaff = this.elements.modalStaffCustomInput.value.trim() || this.elements.modalStaffPresetSelect.value;

          Pipeline.updateTicketStatus(state.selectedTicketForStaff.ticket_id, newStatus, note, assignedStaff);
          this.closeModal(this.elements.staffModal);
        });
      }

      // --- Edit Modal Handlers ---
      if (this.elements.closeEditModalBtn) {
        this.elements.closeEditModalBtn.addEventListener('click', () => this.closeModal(this.elements.editTicketModal));
      }
      if (this.elements.cancelEditBtn) {
        this.elements.cancelEditBtn.addEventListener('click', () => this.closeModal(this.elements.editTicketModal));
      }
      if (this.elements.saveEditTicketBtn) {
        this.elements.saveEditTicketBtn.addEventListener('click', () => {
          if (!state.selectedTicketForEdit) return;
          const ticketId = state.selectedTicketForEdit.ticket_id;
          const updateData = {
            complaint_text: this.elements.editComplaintText.value.trim(),
            summary: this.elements.editSummaryText.value.trim(),
            department: this.elements.editDepartmentSelect.value,
            priority: this.elements.editPrioritySelect.value,
            status: this.elements.editStatusSelect.value,
            assigned_staff: this.elements.editStaffCustomInput.value.trim() || this.elements.editStaffPresetSelect.value,
            staff_note: this.elements.editNoteInput.value.trim() || 'Ticket details updated'
          };
          Pipeline.editTicket(ticketId, updateData);
          this.closeModal(this.elements.editTicketModal);
        });
      }

      // --- Delete Modal Handlers ---
      if (this.elements.cancelDeleteBtn) {
        this.elements.cancelDeleteBtn.addEventListener('click', () => this.closeModal(this.elements.deleteConfirmModal));
      }
      if (this.elements.confirmDeleteTicketBtn) {
        this.elements.confirmDeleteTicketBtn.addEventListener('click', () => {
          if (!state.selectedTicketForDelete) return;
          const ticketId = state.selectedTicketForDelete.ticket_id;
          Pipeline.deleteTicket(ticketId);
          this.closeModal(this.elements.deleteConfirmModal);
        });
      }

      // --- Settings Modal ---
      if (this.elements.settingsBtn) {
        this.elements.settingsBtn.addEventListener('click', () => {
          this.elements.geminiApiKey.value = state.settings.geminiApiKey;
          this.openModal(this.elements.settingsModal);
        });
      }
      if (this.elements.closeSettingsModal) {
        this.elements.closeSettingsModal.addEventListener('click', () => this.closeModal(this.elements.settingsModal));
      }
      if (this.elements.saveSettingsBtn) {
        this.elements.saveSettingsBtn.addEventListener('click', () => {
          state.settings.geminiApiKey = this.elements.geminiApiKey.value.trim();
          state.settings.voiceName = this.elements.ttsVoiceSelect.value;
          localStorage.setItem('voxact_gemini_key', state.settings.geminiApiKey);
          localStorage.setItem('voxact_voice_name', state.settings.voiceName);
          this.closeModal(this.elements.settingsModal);
          this.setStatus('Settings saved', 'ready');
        });
      }

      // --- Sound Toggle ---
      if (this.elements.soundToggleBtn) {
        this.elements.soundToggleBtn.addEventListener('click', () => {
          state.settings.soundMuted = !state.settings.soundMuted;
          this.elements.soundIcon.className = state.settings.soundMuted ? 'w-4 h-4 text-slate-400' : 'w-4 h-4 text-[#F07864]';
        });
      }
    },

    switchTab(tab) {
      state.activeTab = tab;
      if (tab === 'student') {
        this.elements.navStudentTab.classList.add('active');
        this.elements.navStaffTab.classList.remove('active');
        this.elements.studentDashboardView.classList.remove('hidden');
        this.elements.staffDashboardView.classList.add('hidden');
      } else {
        this.elements.navStaffTab.classList.add('active');
        this.elements.navStudentTab.classList.remove('active');
        this.elements.staffDashboardView.classList.remove('hidden');
        this.elements.studentDashboardView.classList.add('hidden');
        Pipeline.fetchAllTickets();
        this.renderTickets();
        this.updateStats();
      }
    },

    openModal(modal) {
      if (modal) modal.classList.remove('hidden');
    },

    closeModal(modal) {
      if (modal) modal.classList.add('hidden');
    },

    setListeningState(isListening) {
      if (isListening) {
        this.elements.micBtn.classList.add('mic-active');
        this.elements.micPulseRing.classList.add('mic-recording');
        this.elements.orbGlow.classList.add('scale-125', 'opacity-90');
        this.elements.micLabel.textContent = 'Listening...';
        this.setStatus('Listening to student complaint... Speak clearly into microphone', 'listening');
      } else {
        this.elements.micBtn.classList.remove('mic-active');
        this.elements.micPulseRing.classList.remove('mic-recording');
        this.elements.orbGlow.classList.remove('scale-125', 'opacity-90');
        this.elements.micLabel.textContent = 'Speak';
      }
    },

    setStatus(text, type = 'ready') {
      this.elements.statusText.textContent = text;
      const dot = this.elements.statusDot;
      dot.className = 'w-2 h-2 rounded-full';
      if (type === 'listening') {
        dot.classList.add('bg-[#F07864]', 'animate-ping');
      } else if (type === 'processing') {
        dot.classList.add('bg-amber-500', 'animate-spin');
      } else if (type === 'warning') {
        dot.classList.add('bg-rose-500');
      } else {
        dot.classList.add('bg-[#F07864]');
      }
    },

    setTranscript(text, isInterim = false) {
      this.elements.liveTranscript.textContent = `"${text}"`;
      if (isInterim) {
        this.elements.liveTranscript.classList.add('text-[#F07864]');
      } else {
        this.elements.liveTranscript.classList.remove('text-[#F07864]');
      }
    },

    showVoiceOut(text) {
      state.lastVoiceResponse = text;
      this.elements.voiceOutText.textContent = `"${text}"`;
      this.elements.voiceOutCard.classList.remove('hidden');
    },

    showStudentTicketSuccess(ticket) {
      this.elements.successTicketId.textContent = ticket.ticket_id;
      this.elements.successDeptBadge.textContent = ticket.department || 'General';
      this.elements.successPriorityBadge.textContent = ticket.priority || 'Medium';

      // Priority color styling
      if (ticket.priority === 'Critical') {
        this.elements.successPriorityBadge.className = 'text-xs px-2.5 py-1 rounded-lg bg-rose-100 text-rose-700 border border-rose-200 font-semibold uppercase';
      } else if (ticket.priority === 'High') {
        this.elements.successPriorityBadge.className = 'text-xs px-2.5 py-1 rounded-lg bg-[#FCE9E3] text-[#F07864] border border-[#F07864]/40 font-semibold uppercase';
      } else {
        this.elements.successPriorityBadge.className = 'text-xs px-2.5 py-1 rounded-lg bg-[#FFF9F5] text-[#34394A] border border-[#FCE9E3] font-semibold uppercase';
      }

      this.elements.successAiSummary.textContent = ticket.summary || ticket.complaint_text;
      this.elements.successStatusBadge.textContent = ticket.status;
      this.elements.successAssignedStaff.textContent = `Assigned to: ${ticket.assigned_staff || 'Unassigned'}`;

      this.elements.studentTicketSuccessCard.classList.remove('hidden');
      this.elements.studentTicketSuccessCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    renderTrackResult(ticket) {
      const container = this.elements.trackResultContainer;
      container.classList.remove('hidden');

      const isResolved = ticket.status === 'Resolved' || ticket.status === 'Closed';
      const isInProgress = ticket.status === 'In Progress';

      const statusBadgeClass = isResolved
        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
        : isInProgress
        ? 'bg-[#FCE9E3] text-[#F07864] border-[#F07864]/40'
        : 'bg-rose-100 text-rose-700 border-rose-200';

      const priorityBadgeClass = ticket.priority === 'Critical'
        ? 'bg-rose-100 text-rose-700 border-rose-200'
        : ticket.priority === 'High'
        ? 'bg-[#FCE9E3] text-[#F07864] border-[#F07864]/40'
        : 'bg-[#FFF9F5] text-[#34394A] border border-[#FCE9E3]';

      const historyHtml = (ticket.history && ticket.history.length > 0)
        ? ticket.history.map((h, i) => `
            <div class="flex items-start gap-2.5 relative pl-4 border-l border-[#FCE9E3] pb-2.5 last:pb-0">
              <span class="absolute -left-1.5 top-1 w-3 h-3 rounded-full ${i === ticket.history.length - 1 ? 'bg-[#F07864]' : 'bg-slate-300'}"></span>
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-[#34394A]">${escapeHtml(h.status || 'Update')}</span>
                  <span class="text-[10px] text-slate-500">${escapeHtml(h.time || '')}</span>
                </div>
                <p class="text-slate-600 text-[11px] mt-0.5">${escapeHtml(h.note || 'Status updated')}</p>
              </div>
            </div>
          `).join('')
        : '<p class="text-slate-400 italic">No notes recorded yet.</p>';

      container.innerHTML = `
        <div class="p-4 sm:p-5 rounded-xl bg-white border border-[#FCE9E3] shadow-md animate-fade-in flex flex-col gap-3.5 text-[#34394A]">
          <!-- Top Row -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#FCE9E3]">
            <div class="flex items-center gap-2">
              <span class="font-mono text-base font-extrabold text-[#F07864] bg-[#FCE9E3] px-2.5 py-0.5 rounded-md">${escapeHtml(ticket.ticket_id)}</span>
              <span class="text-xs px-2 py-0.5 rounded border ${priorityBadgeClass} font-bold uppercase">${escapeHtml(ticket.priority)}</span>
              <span class="text-xs px-2 py-0.5 rounded border ${statusBadgeClass} font-bold uppercase">${escapeHtml(ticket.status)}</span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="window.voxactOpenEditModal('${escapeHtml(ticket.ticket_id)}')" class="px-2.5 py-1 rounded-md bg-[#FFF9F5] hover:bg-[#FCE9E3] border border-[#FCE9E3] text-[#34394A] text-xs font-medium flex items-center gap-1 transition-all" title="Edit this complaint">
                <i data-lucide="edit-2" class="w-3.5 h-3.5 text-[#F07864]"></i>
                <span>Edit</span>
              </button>
              <button onclick="window.voxactOpenDeleteModal('${escapeHtml(ticket.ticket_id)}')" class="px-2.5 py-1 rounded-md bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-xs font-medium flex items-center gap-1 transition-all" title="Delete this complaint">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-600"></i>
                <span>Delete</span>
              </button>
            </div>
          </div>

          <!-- Staff Assignment & Summary -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div class="p-3 rounded-lg bg-[#FFF9F5] border border-[#FCE9E3]">
              <span class="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Assigned Technician / Staff</span>
              <span class="text-sm font-semibold text-[#34394A] flex items-center gap-1.5">
                <i data-lucide="user-check" class="w-4 h-4 text-[#F07864]"></i>
                ${escapeHtml(ticket.assigned_staff || 'Pending Assignment')}
              </span>
            </div>
            <div class="p-3 rounded-lg bg-[#FFF9F5] border border-[#FCE9E3]">
              <span class="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Department &amp; Created At</span>
              <span class="text-xs text-[#34394A] font-semibold block">${escapeHtml(ticket.department)}</span>
              <span class="text-[10px] text-slate-500 font-mono">${escapeHtml(ticket.created_at || 'Recently')}</span>
            </div>
          </div>

          <!-- Original Complaint & AI Summary -->
          <div class="text-xs space-y-2">
            <div class="p-3 rounded-lg bg-[#FFF9F5] border border-[#FCE9E3] text-[#34394A]">
              <span class="text-[10px] font-bold uppercase text-[#F07864] block mb-1">Student Voice Complaint</span>
              "${escapeHtml(ticket.complaint_text)}"
            </div>
            ${ticket.summary ? `
              <div class="p-2.5 rounded-lg bg-[#FCE9E3]/50 text-[#34394A] border border-[#F07864]/20 text-[11px]">
                <strong class="text-[#F07864]">AI Summary:</strong> ${escapeHtml(ticket.summary)}
              </div>
            ` : ''}
          </div>

          <!-- Timeline / Notes History -->
          <div class="pt-2 border-t border-[#FCE9E3]">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Resolution Progress History:</span>
            <div class="space-y-1 text-xs">
              ${historyHtml}
            </div>
          </div>
        </div>
      `;

      if (window.lucide) window.lucide.createIcons();
    },

    renderTrackNotFound(ticketId) {
      const container = this.elements.trackResultContainer;
      container.classList.remove('hidden');
      container.innerHTML = `
        <div class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-center animate-fade-in text-[#34394A]">
          <i data-lucide="alert-triangle" class="w-6 h-6 text-rose-600 mx-auto mb-1"></i>
          <h4 class="font-bold text-sm text-rose-700">Ticket Not Found</h4>
          <p class="text-xs text-slate-600 mt-1">
            Could not find <code class="font-mono bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-bold">${escapeHtml(ticketId)}</code> in the MongoDB database. Please verify your Ticket ID.
          </p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    },

    renderStudentRecentTickets() {
      const container = this.elements.studentRecentTicketsList;
      if (!container) return;

      if (!state.studentTickets || state.studentTickets.length === 0) {
        container.innerHTML = `
          <div class="col-span-full p-5 rounded-xl bg-white border border-[#FCE9E3] text-slate-500 text-center italic text-xs">
            No complaints submitted yet. Use the microphone or sample buttons above to register a complaint.
          </div>
        `;
        return;
      }

      container.innerHTML = state.studentTickets.map(t => {
        const isResolved = t.status === 'Resolved' || t.status === 'Closed';
        const isInProgress = t.status === 'In Progress';
        const badgeColor = isResolved
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
          : isInProgress
          ? 'bg-[#FCE9E3] text-[#F07864] border-[#F07864]/40'
          : 'bg-rose-100 text-rose-700 border-rose-200';

        return `
          <div class="p-3.5 rounded-xl bg-white border border-[#FCE9E3] hover:border-[#F07864]/60 transition-all flex flex-col justify-between gap-2.5 shadow-sm hover:shadow">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="font-mono font-bold text-[#F07864] bg-[#FCE9E3] px-2 py-0.5 rounded text-xs">${escapeHtml(t.ticket_id)}</span>
                <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${badgeColor}">${escapeHtml(t.status)}</span>
              </div>
              <p class="text-xs text-[#34394A] font-medium line-clamp-2">${escapeHtml(t.summary || 'Complaint registered')}</p>
              <div class="text-[10px] text-slate-500 mt-2 flex flex-col gap-0.5">
                <span>Dept: <strong class="text-[#34394A]">${escapeHtml(t.department || 'General')}</strong></span>
                <span>Assigned: <strong class="text-[#F07864]">${escapeHtml(t.assigned_staff || 'Unassigned')}</strong></span>
              </div>
            </div>

            <!-- Actions: Track, Edit, Delete -->
            <div class="flex items-center gap-1.5 pt-2 border-t border-[#FCE9E3]">
              <button onclick="window.voxactQuickTrack('${escapeHtml(t.ticket_id)}')" class="flex-1 py-1 rounded-lg bg-[#F07864] hover:bg-[#e0624d] text-white text-[11px] font-semibold transition-all flex items-center justify-center gap-1 shadow-sm">
                <i data-lucide="crosshair" class="w-3 h-3"></i>
                <span>Track</span>
              </button>
              <button onclick="window.voxactOpenEditModal('${escapeHtml(t.ticket_id)}')" class="p-1.5 rounded-lg bg-[#FFF9F5] hover:bg-[#FCE9E3] border border-[#FCE9E3] text-[#34394A] hover:text-[#F07864] transition-all" title="Edit this complaint">
                <i data-lucide="edit-2" class="w-3.5 h-3.5 text-[#F07864]"></i>
              </button>
              <button onclick="window.voxactOpenDeleteModal('${escapeHtml(t.ticket_id)}')" class="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 transition-all" title="Delete this complaint">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-600"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    },

    populateVoiceSelect(voices) {
      if (!this.elements.ttsVoiceSelect) return;
      this.elements.ttsVoiceSelect.innerHTML = '';
      voices.forEach(voice => {
        const opt = document.createElement('option');
        opt.value = voice.name;
        opt.textContent = `${voice.name} (${voice.lang})`;
        if (voice.name === state.settings.voiceName || (voice.default && !state.settings.voiceName)) {
          opt.selected = true;
        }
        this.elements.ttsVoiceSelect.appendChild(opt);
      });
    },

    updateStats() {
      const total = state.tickets.length;
      const open = state.tickets.filter(t => t.status === 'Open').length;
      const progress = state.tickets.filter(t => t.status === 'In Progress').length;
      const resolved = state.tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length;

      if (this.elements.statTotalTickets) this.elements.statTotalTickets.textContent = total;
      if (this.elements.statOpenTickets) this.elements.statOpenTickets.textContent = open;
      if (this.elements.statProgressTickets) this.elements.statProgressTickets.textContent = progress;
      if (this.elements.statResolvedTickets) this.elements.statResolvedTickets.textContent = resolved;

      const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
      if (this.elements.resolutionRateBadge) {
        this.elements.resolutionRateBadge.textContent = `Resolution Rate: ${rate}% (${resolved}/${total})`;
      }

      // Department breakdown progress bars
      const depts = [
        { name: 'IT Support', color: 'bg-[#F07864]' },
        { name: 'Hostel', color: 'bg-[#202638]' },
        { name: 'Facilities', color: 'bg-[#e0624d]' },
        { name: 'Academic', color: 'bg-[#f43f5e]' }
      ];

      if (this.elements.deptProgressBar) {
        this.elements.deptProgressBar.innerHTML = depts.map(d => {
          const count = state.tickets.filter(t => t.department && t.department.toLowerCase().includes(d.name.toLowerCase())).length;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return `
            <div class="p-2.5 rounded-lg bg-white border border-[#FCE9E3]">
              <div class="flex items-center justify-between mb-1">
                <span class="text-[#34394A] font-semibold text-xs">${d.name}</span>
                <span class="font-mono text-[#F07864] font-bold text-xs">${count} (${pct}%)</span>
              </div>
              <div class="w-full bg-[#FFF9F5] rounded-full h-2 overflow-hidden border border-[#FCE9E3]">
                <div class="${d.color} h-2 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    },

    renderTickets() {
      if (!this.elements.ticketsGrid) return;

      const deptFilter = this.elements.filterDepartment ? this.elements.filterDepartment.value : 'ALL';
      const priorityFilter = this.elements.filterPriority ? this.elements.filterPriority.value : 'ALL';
      const statusFilter = this.elements.filterStatus ? this.elements.filterStatus.value : 'ALL';
      const search = (this.elements.ticketSearchInput ? this.elements.ticketSearchInput.value : '').toLowerCase().trim();

      let filtered = state.tickets.filter(t => {
        const matchesDept = deptFilter === 'ALL' || (t.department && t.department.includes(deptFilter));
        const matchesPriority = priorityFilter === 'ALL' || t.priority === priorityFilter;
        const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
        const matchesSearch = !search ||
          (t.ticket_id && t.ticket_id.toLowerCase().includes(search)) ||
          (t.complaint_text && t.complaint_text.toLowerCase().includes(search)) ||
          (t.summary && t.summary.toLowerCase().includes(search)) ||
          (t.department && t.department.toLowerCase().includes(search)) ||
          (t.assigned_staff && t.assigned_staff.toLowerCase().includes(search)) ||
          (t.priority && t.priority.toLowerCase().includes(search));

        return matchesDept && matchesPriority && matchesStatus && matchesSearch;
      });

      if (this.elements.ticketCountLabel) {
        this.elements.ticketCountLabel.textContent = `Showing ${filtered.length} of ${state.tickets.length} complaints`;
      }

      if (filtered.length === 0) {
        this.elements.ticketsGrid.innerHTML = `
          <div class="col-span-full p-8 text-center text-slate-500 italic text-xs bg-white rounded-xl border border-[#FCE9E3]">
            No complaints found matching the selected filters.
          </div>`;
        return;
      }

      this.elements.ticketsGrid.innerHTML = filtered.map(t => {
        const isCritical = t.priority === 'Critical';
        const isHigh = t.priority === 'High';
        const priorityBadgeClass = isCritical
          ? 'bg-rose-100 text-rose-700 border-rose-200 animate-pulse'
          : isHigh
          ? 'bg-[#FCE9E3] text-[#F07864] border-[#F07864]/40'
          : 'bg-[#FFF9F5] text-[#34394A] border border-[#FCE9E3]';

        const statusClass = t.status === 'Open'
          ? 'bg-rose-100 text-rose-700 border-rose-200'
          : t.status === 'In Progress'
          ? 'bg-[#FCE9E3] text-[#F07864] border-[#F07864]/40'
          : 'bg-emerald-100 text-emerald-700 border-emerald-200';

        const latestHistory = t.history && t.history.length > 0 ? t.history[t.history.length - 1] : null;

        return `
          <div class="p-4 rounded-xl bg-white border border-[#FCE9E3] hover:border-[#F07864]/60 transition-all flex flex-col justify-between group shadow-sm hover:shadow-md animate-fade-in text-[#34394A]">
            <div>
              <!-- Header info -->
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-mono text-xs font-extrabold text-[#F07864] bg-[#FCE9E3] px-2 py-0.5 rounded-md">${escapeHtml(t.ticket_id)}</span>
                  <span class="text-[11px] font-semibold text-[#34394A] truncate">${escapeHtml(t.department)}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="text-[9px] uppercase font-bold px-2 py-0.5 rounded border ${priorityBadgeClass}">${escapeHtml(t.priority)}</span>
                  <span class="text-[9px] uppercase font-bold px-2 py-0.5 rounded border ${statusClass}">${escapeHtml(t.status)}</span>
                </div>
              </div>

              <!-- Assigned Staff Badge -->
              <div class="mb-2 flex items-center gap-1.5 text-[11px]">
                <span class="px-2 py-0.5 rounded-md bg-[#FFF9F5] border border-[#FCE9E3] text-[#34394A] flex items-center gap-1">
                  <i data-lucide="user-check" class="w-3.5 h-3.5 text-[#F07864]"></i>
                  <span>Assigned: <strong>${escapeHtml(t.assigned_staff || 'Unassigned')}</strong></span>
                </span>
              </div>

              <!-- Complaint text -->
              <p class="text-xs text-[#34394A] font-medium my-2 bg-[#FFF9F5] p-3 rounded-lg border border-[#FCE9E3] leading-relaxed">
                "${escapeHtml(t.complaint_text)}"
              </p>

              <!-- Staff notes if any -->
              ${latestHistory && latestHistory.note ? `
                <div class="text-[10px] text-[#34394A] bg-[#FCE9E3]/60 border border-[#F07864]/30 rounded-md p-2 flex items-start gap-1.5 mb-2">
                  <i data-lucide="info" class="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#F07864]"></i>
                  <span>${escapeHtml(latestHistory.note)} (${escapeHtml(latestHistory.time || '')})</span>
                </div>
              ` : ''}
            </div>

            <!-- Footer: Timestamp & Action Controls (Edit, Delete, Staff Triage, Cycle) -->
            <div class="flex items-center justify-between pt-2.5 border-t border-[#FCE9E3] mt-1 text-[11px]">
              <span class="text-slate-400 text-[10px]">${escapeHtml(t.created_at || 'Recently')}</span>
              
              <div class="flex items-center gap-1">
                <!-- Edit Button -->
                <button onclick="window.voxactOpenEditModal('${escapeHtml(t.ticket_id)}')" class="p-1.5 rounded-md bg-[#FFF9F5] hover:bg-[#FCE9E3] border border-[#FCE9E3] text-[#34394A] transition-all" title="Edit complaint details">
                  <i data-lucide="edit-2" class="w-3.5 h-3.5 text-[#F07864]"></i>
                </button>

                <!-- Delete Button -->
                <button onclick="window.voxactOpenDeleteModal('${escapeHtml(t.ticket_id)}')" class="p-1.5 rounded-md bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 transition-all" title="Delete complaint permanently">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-600"></i>
                </button>

                <!-- Quick Cycle Button -->
                <button onclick="window.voxactCycleQuickStatus('${escapeHtml(t.ticket_id)}')" class="px-2 py-1 rounded-md bg-[#FFF9F5] hover:bg-[#FCE9E3] border border-[#FCE9E3] text-[#34394A] text-[10px] font-medium transition-all" title="Quick change status">
                  Cycle &rarr;
                </button>

                <!-- Staff Triage Modal Button -->
                <button onclick="window.voxactOpenStaffModal('${escapeHtml(t.ticket_id)}')" class="px-2.5 py-1 rounded-md bg-[#202638] hover:bg-[#2d354a] text-white text-[10px] font-semibold flex items-center gap-1 transition-all shadow-sm" title="Staff Status & Notes">
                  <i data-lucide="user-check" class="w-3 h-3 text-[#F07864]"></i>
                  <span>Triage</span>
                </button>
              </div>
            </div>

          </div>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    },

    exportPdf() {
      try {
        if (!window.jspdf || !window.jspdf.jsPDF) {
          window.print();
          return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        // Title Header
        doc.setFontSize(16);
        doc.setTextColor(32, 38, 56);
        doc.text("VOXACT AI — CAMPUS VOICE GRIEVANCE & TICKETS REPORT", 40, 42);

        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        const dateStr = new Date().toLocaleString();
        doc.text(`Generated on: ${dateStr}  |  MongoDB Database: voxact_campus_grievance`, 40, 58);

        // Summary Stats
        const total = state.tickets.length;
        const open = state.tickets.filter(t => t.status === 'Open').length;
        const progress = state.tickets.filter(t => t.status === 'In Progress').length;
        const resolved = state.tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length;

        doc.setFontSize(9.5);
        doc.setTextColor(52, 57, 74);
        doc.text(`Status Summary:  Total Complaints: ${total}   |   Open: ${open}   |   In Progress: ${progress}   |   Resolved: ${resolved}`, 40, 75);

        // Table Data
        const headers = [["Ticket ID", "Department", "Priority", "Status", "Assigned Staff", "Student Complaint Description", "Created Date"]];
        const rows = state.tickets.map(t => [
          t.ticket_id || "N/A",
          t.department || "General",
          t.priority || "Normal",
          t.status || "Open",
          t.assigned_staff || "Unassigned",
          t.complaint_text || t.summary || "No description",
          t.created_at || "Recent"
        ]);

        doc.autoTable({
          head: headers,
          body: rows,
          startY: 90,
          theme: 'grid',
          headStyles: {
            fillColor: [32, 38, 56],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8.5
          },
          bodyStyles: {
            fontSize: 8,
            cellPadding: 5,
            textColor: [52, 57, 74]
          },
          columnStyles: {
            0: { cellWidth: 60, fontStyle: 'bold' },
            1: { cellWidth: 120 },
            2: { cellWidth: 55 },
            3: { cellWidth: 65 },
            4: { cellWidth: 100 },
            5: { cellWidth: 'auto' },
            6: { cellWidth: 95 }
          },
          didParseCell: function(data) {
            if (data.section === 'body') {
              if (data.column.index === 2) {
                if (data.cell.raw === 'Critical') {
                  data.cell.styles.textColor = [225, 29, 72];
                  data.cell.styles.fontStyle = 'bold';
                } else if (data.cell.raw === 'High') {
                  data.cell.styles.textColor = [240, 120, 100];
                  data.cell.styles.fontStyle = 'bold';
                }
              }
              if (data.column.index === 3) {
                if (data.cell.raw === 'Open') {
                  data.cell.styles.textColor = [225, 29, 72];
                } else if (data.cell.raw === 'In Progress') {
                  data.cell.styles.textColor = [240, 120, 100];
                } else if (data.cell.raw === 'Resolved') {
                  data.cell.styles.textColor = [16, 185, 129];
                  data.cell.styles.fontStyle = 'bold';
                }
              }
            }
          },
          margin: { left: 40, right: 40 }
        });

        const filename = `campus_grievances_report_${Date.now()}.pdf`;
        doc.save(filename);
        UI.setStatus(`Exported official PDF report: ${filename}`, 'ready');
      } catch (err) {
        console.error('PDF export error:', err);
        this.exportCsv();
      }
    },

    exportCsv() {
      let csv = 'TicketID,Department,Priority,Status,AssignedStaff,Complaint,CreatedAt\n';
      state.tickets.forEach(t => {
        csv += `"${t.ticket_id}","${t.department}","${t.priority}","${t.status}","${t.assigned_staff || 'Unassigned'}","${(t.complaint_text || '').replace(/"/g, '""')}","${t.created_at}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campus_grievances_mongodb_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Global Window Helpers ---
  window.voxactOpenStaffModal = function (ticketId) {
    const ticket = state.tickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return;
    state.selectedTicketForStaff = ticket;
    document.getElementById('modalTicketId').textContent = ticket.ticket_id;
    document.getElementById('modalTicketComplaint').textContent = `"${ticket.complaint_text}"`;
    document.getElementById('modalStatusSelect').value = ticket.status;
    document.getElementById('modalStaffPresetSelect').value = ticket.assigned_staff || '';
    document.getElementById('modalStaffCustomInput').value = '';
    document.getElementById('modalStaffNote').value = '';
    UI.openModal(document.getElementById('staffModal'));
  };

  window.voxactCycleQuickStatus = function (ticketId) {
    const ticket = state.tickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return;
    const flow = ['Open', 'In Progress', 'Resolved'];
    const nextIdx = (flow.indexOf(ticket.status) + 1) % flow.length;
    const newStatus = flow[nextIdx];
    Pipeline.updateTicketStatus(ticketId, newStatus, `Staff advanced status to ${newStatus}`, ticket.assigned_staff);
  };

  window.voxactQuickTrack = function (ticketId) {
    const input = document.getElementById('trackInputTicketId');
    if (input) {
      input.value = ticketId;
      document.getElementById('trackLookupForm').dispatchEvent(new Event('submit'));
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  window.voxactOpenEditModal = function (ticketId) {
    let ticket = state.tickets.find(t => t.ticket_id === ticketId);
    if (!ticket) {
      ticket = state.studentTickets.find(t => t.ticket_id === ticketId);
    }
    if (!ticket) return;

    state.selectedTicketForEdit = ticket;
    document.getElementById('editModalTicketId').textContent = ticket.ticket_id;
    document.getElementById('editComplaintText').value = ticket.complaint_text || ticket.summary || '';
    document.getElementById('editSummaryText').value = ticket.summary || '';
    document.getElementById('editDepartmentSelect').value = ticket.department || 'IT Support & Infrastructure';
    document.getElementById('editPrioritySelect').value = ticket.priority || 'Medium';
    document.getElementById('editStatusSelect').value = ticket.status || 'Open';
    document.getElementById('editStaffPresetSelect').value = ticket.assigned_staff || '';
    document.getElementById('editStaffCustomInput').value = '';
    document.getElementById('editNoteInput').value = '';

    UI.openModal(document.getElementById('editTicketModal'));
  };

  window.voxactOpenDeleteModal = function (ticketId) {
    let ticket = state.tickets.find(t => t.ticket_id === ticketId);
    if (!ticket) {
      ticket = state.studentTickets.find(t => t.ticket_id === ticketId);
    }
    if (!ticket) return;

    state.selectedTicketForDelete = ticket;
    document.getElementById('deleteModalTicketId').textContent = ticket.ticket_id;
    document.getElementById('deleteModalComplaintPreview').textContent = `"${ticket.complaint_text || ticket.summary || ''}"`;

    UI.openModal(document.getElementById('deleteConfirmModal'));
  };

  window.addEventListener('DOMContentLoaded', () => {
    UI.init();
    Visualizer.init();
    VoiceInput.init();
    VoiceOutput.init();
    AudioFX.init();
  });

})();
