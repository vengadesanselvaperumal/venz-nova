VENZNOVA — NIFT/CONNECT v2.0
============================

This build is a complete zero-dependency Node.js website. It does NOT require npm install.

REQUIREMENT
- Node.js 18 or newer

START ON WINDOWS
1. Extract this ZIP.
2. Open PowerShell in the extracted VENZNOVA folder.
3. Run:
   npm start
4. Open:
   http://localhost:3000

IMPORTANT
- Do not open index.html directly. Start server.js with npm start.
- Do not mix files from the old VENZNOVA project with this build.
- The website stores local data in data/db.json and uploaded files in uploads/.

DEMO ACCOUNT
Email: demo@venz-nova.local
Password: Demo1234

MAIN FEATURES
- Home landing page
- Separate Marketplace
- Separate Doubt Desk
- Separate Opportunities
- Network directory
- Sign up / Login / Logout
- BFTech programme and Roll Number
- Student project publishing
- Public project file uploads
- Project likes
- Doubt answers
- Internship/job/freelance/project opportunities
- Opportunity applications
- Connections
- Direct messages
- Dashboard and notifications
- Local JSON persistence

PROJECT UPLOADS
Students can log in -> Marketplace -> Upload project.
A public project appears in Marketplace for everyone.
Supported uploads include PDF, images, Word, PowerPoint and ZIP.
Maximum upload size is approximately 15 MB.

IF YOU WANT TO RESET EVERYTHING
Stop the server, then delete:
- data/db.json
- all files inside uploads/
Start again with npm start. A demo account and demo content will be recreated.
