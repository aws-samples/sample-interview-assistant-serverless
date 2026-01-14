# Interview Practice Assistant - Frontend

React-based frontend application using Cloudscape Design System.

## Features

- 📊 Dashboard with statistics and recent sessions
- 🎯 Multi-step practice wizard
- 📝 CV and Job Description upload
- ❓ AI-generated interview questions
- 💬 Answer submission (text-based)
- 📈 Session history and analytics
- 💾 Question bank management
- ⚙️ User settings

## Tech Stack

- React 18
- React Router v6
- Cloudscape Design System
- Axios (REST API)
- Socket.io-client (WebSocket)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm start
```

The application will open at http://localhost:3000

## Project Structure

```
src/
├── components/        # Reusable UI components
├── pages/            # Page components
│   ├── Dashboard.jsx
│   ├── PracticeWizard.jsx
│   ├── SessionHistory.jsx
│   ├── QuestionBank.jsx
│   └── Settings.jsx
├── services/         # API and WebSocket services
│   ├── api.js
│   └── websocket.js
├── hooks/            # Custom React hooks
└── App.js           # Main application component
```

## Available Scripts

### `npm start`

Runs the app in development mode at http://localhost:3000

### `npm build`

Builds the app for production to the `build` folder

### `npm test`

Launches the test runner

## Environment Variables

Create a `.env` file in the root directory:

```env
REACT_APP_API_URL=http://localhost:3001/api
REACT_APP_WS_URL=http://localhost:3001
```

## Pages

### Dashboard

- Overview statistics (total sessions, average score, last practice date)
- Recent practice sessions table
- Quick start button for new sessions
- Getting started guide

### Practice Wizard

**Step 1: Setup**

- CV upload (file or text)
- Job description upload (file or text)
- Interview settings (question count, difficulty, focus area)

**Step 2: Review Questions**

- View AI-generated questions
- Edit or regenerate individual questions
- Customize before starting practice

**Step 3: Practice**

- Answer interview questions
- Text input for answers (speech coming soon)
- Navigation between questions
- Submit for feedback

### Session History

- List all past practice sessions
- Filter and search functionality
- View detailed session results
- Delete sessions

### Question Bank

- Browse saved questions by category
- Add custom questions
- Import questions from CSV (coming soon)
- Interview Copilot feature placeholder

### Settings

- Audio settings (coming soon)
- AI interview style preferences
- Feedback detail level
- Default CV management
- Target roles

## API Integration

The frontend communicates with the backend through:

1. **REST API** (via Axios)
   - Session management
   - Question retrieval
   - Answer submission
   - Analytics data

2. **WebSocket** (via Socket.io)
   - Real-time session updates
   - Question generation progress
   - Feedback notifications
   - Agent status updates

## WebSocket Events

**Incoming:**

- `session:created` - New session created
- `session:updated` - Session data updated
- `session:progress` - Progress updates
- `agent:status` - Agent processing status
- `question:generated` - New question available
- `questions:complete` - All questions generated
- `feedback:ready` - Feedback analysis complete

**Outgoing:**

- `subscribe:session` - Subscribe to session updates
- `unsubscribe:session` - Unsubscribe from session

## UI Components (Cloudscape)

Main components used:

- `AppLayout` - Main application layout
- `TopNavigation` - Header navigation
- `SideNavigation` - Sidebar menu
- `Wizard` - Multi-step form
- `Table` - Data tables
- `Cards` - Card layouts
- `Container` - Content containers
- `Flashbar` - Notifications

## Styling

Uses Cloudscape Design System's built-in theming:

- Consistent AWS design language
- Responsive layouts
- Accessible components
- Dark mode support (coming soon)

## Future Features

- 🎤 Speech-to-speech interview practice
- 🎙️ Real-time voice transcription
- 📊 Advanced analytics dashboards
- 🤖 Interview Copilot with real-time suggestions
- 🌐 Multi-language support
- 📱 Mobile responsive design improvements

## Troubleshooting

### WebSocket connection issues

- Check backend server is running on port 3001
- Verify `REACT_APP_WS_URL` in `.env`
- Check browser console for connection errors

### API request failures

- Ensure backend API is running
- Verify `REACT_APP_API_URL` in `.env`
- Check network tab in browser DevTools

## Contributing

This is a demo application. For production use, consider:

- Adding authentication
- Implementing proper error boundaries
- Adding comprehensive tests
- Optimizing bundle size
- Adding loading states and error handling
