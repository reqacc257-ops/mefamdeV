# MEFAMDEV Web Application Architecture

## 1. Overview
MEFAMDEV is a scholarship management web application that supports:
- public scholarship application submission
- applicant portal access
- staff/admin dashboard operations
- document checklist management
- communications and announcements
- attendance, financial, and assessment tracking

## 2. System Goals
- Allow applicants to apply online and track their status
- Let staff manage applications, documents, and communication
- Provide a simple, reliable, and secure internal workflow
- Keep the solution lightweight and easy to deploy on Railway

## 3. High-Level Architecture

### Client Layer
- Static web pages served from the public folder
- HTML pages for:
  - applicant portal
  - admin dashboard
  - application form
  - intake sheets
  - staff assessment views
- Client-side JavaScript uses a shared API wrapper for all requests

### Application Layer
- Node.js with Express server
- Main entry point: server.js
- Route modules grouped by domain:
  - auth
  - applications
  - families
  - events
  - financials
  - records
  - documents
  - comms

### Data Layer
- JSON-based persistence through a lightweight in-memory storage layer
- Data is stored in the project data directory
- The current structure is simple and suitable for deployment and small-to-medium use

## 4. Core Components

### Frontend
- Public-facing application form
- Applicant portal for viewing status and requirements
- Staff dashboard for case management and operations

### Backend
- Express API server
- JWT-based authentication
- Role-aware access for staff and applicants
- REST-style routes for CRUD and status operations

### Data Models
- Applications
- Families
- Events and attendance
- Financial logs and disbursements
- Intake sheets
- Assessments
- Announcements
- Document checklist entries

## 5. Request Flow
1. Applicant submits application through the public form.
2. The server stores the application record.
3. Applicant logs in to the portal using reference number and name.
4. The portal loads application data and document requirements.
5. Staff can review and update application status and document statuses.
6. Announcements and communications are served to the applicant portal.

## 6. Security Model
- JWT authentication for protected endpoints
- Applicant access limited to their own application data
- Staff roles separated by permissions
- CORS enabled for browser access
- Cache-control headers applied to HTML and JS assets

## 7. Deployment Architecture
- Node.js app hosted on Railway
- Static frontend files served by the same Express server
- Environment variables used for runtime configuration
- Port exposed through the hosting platform

## 8. Recommended Future Enhancements
- Move from JSON storage to PostgreSQL or SQLite for better scalability
- Add file upload support for scanned documents
- Introduce audit logs for applicant and staff actions
- Add email/SMS notifications
- Improve dashboard analytics and reporting

## 9. Suggested Architecture Diagram

Client Browser
  -> Public Application Form / Applicant Portal / Staff Dashboard
  -> Shared API Layer
  -> Express Routes
  -> Authentication + Authorization
  -> Data Store

## 10. Summary
MEFAMDEV currently uses a simple full-stack web architecture built with:
- Node.js + Express for the backend
- HTML/CSS/JavaScript for the frontend
- JSON-based storage for persistence
- JWT authentication for secure access

This architecture is practical, lightweight, and suitable for the current scholarship management workflow.
