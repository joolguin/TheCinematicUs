# Import & Deck Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix desync when one user imports movies while the other is on Import screen by making Import listen to session changes and providing a manual reload button.

**Architecture:** Extract the session listener logic from Swipe into a reusable `useSessionListener` hook. Both Swipe and Import will subscribe to session changes globally. Import gets a manual "Recargar deck" button to reload the deck when the session changes (either from the other user or from within Import after a successful import).

**Tech Stack:** React hooks, Supabase Realtime (postgres_changes), TypeScript

## Global Constraints

- Session listener must clean up subscriptions on unmount
- Session changes must be scoped by `user` (don't notify on sessions you started)
- Deck reload in Import must show loading state
- No breaking changes to existing Swipe behavior

---

## File Structure

- `frontend/src/hooks/useSessionListener.ts` — NEW: Custom hook that listens to session changes and calls a callback
- `frontend/src/screens/Import.tsx` — MODIFY: Add session listener, reload button, loading state
- `frontend/src/screens/Swipe.tsx` — MODIFY: Replace inline listener with `useSessionListener` hook

---

## Task 1: Create useSessionListener Hook

**Files:**
- Create: `frontend/src/hooks/useSessionListener.ts`
- Create: `frontend/src/hooks/index.ts`

**Interfaces:**
- Consumes: `supabase` from `../supabase`, `UserName` from `../types`
- Produces: `useSessionListener(user: UserName, sessionId: string | null, onNewSession: (id: string) => void): void` — hook that sets up Realtime listener, cleans up on unmount

**Steps:**

- [ ] **Step 1: Create the hooks directory**

```bash
mkdir -p /Users/jo/Documents/TheCinematicUs/frontend/src/hooks
```

- [ ] **Step 2: Write the `useSessionListener` hook**

Create `/Users/jo/Documents/TheCinematicUs/frontend/src/hooks/useSessionListener.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import type { UserName } from '../types';

export function useSessionListener(user: UserName, sessionId: string | null, onNewSession: (id: string) => void) {
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const channel = supabase
      .channel('sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const nueva = payload.new as { id: string; started_by: string | null };
          if (nueva.id === sessionIdRef.current) return;
          if (nueva.started_by === user) return;
          onNewSession(nueva.id);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, onNewSession]);
}
```

- [ ] **Step 3: Create hooks index file**

Create `/Users/jo/Documents/TheCinematicUs/frontend/src/hooks/index.ts`:

```typescript
export { useSessionListener } from './useSessionListener';
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jo/Documents/TheCinematicUs && git add frontend/src/hooks && git commit -m "feat: create useSessionListener hook for session change coordination"
```

---

## Task 2: Refactor Swipe to Use useSessionListener

**Files:**
- Modify: `frontend/src/screens/Swipe.tsx`

**Interfaces:**
- Consumes: `useSessionListener` from `../hooks`, existing Swipe logic
- Produces: Same Swipe component behavior, now using the hook

**Steps:**

- [ ] **Step 1: Update Swipe.tsx imports**

In `frontend/src/screens/Swipe.tsx`, replace the import section (lines 1-13) with:

```typescript
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { api, type Movie } from '../api';
import type { UserName, PresenceStatus } from '../types';
import { useSessionListener } from '../hooks';
import { PresenceBadge } from '../components/PresenceBadge';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
const MatchesList = lazy(() =>
  import('../components/MatchesList').then((m) => ({ default: m.MatchesList })),
);
```

- [ ] **Step 2: Remove sessionIdRef declaration**

Delete line 24 (`const sessionIdRef = useRef<string | null>(null);`) from Swipe.tsx.

- [ ] **Step 3: Replace session listener effects with hook**

Find the two session-related effects (the one at line 32 `useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);` and the big one at lines 52-66).

Replace both with:

```typescript
  useSessionListener(user, sessionId, (newSessionId) => {
    setAviso(`Empezó una noche nueva`);
    softReset(newSessionId);
    setTimeout(() => setAviso(null), 4000);
  });
```

- [ ] **Step 4: Run tests to ensure no regression**

```bash
cd /Users/jo/Documents/TheCinematicUs && npm test --prefix frontend 2>&1 | head -50
```

Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/jo/Documents/TheCinematicUs && git add frontend/src/screens/Swipe.tsx && git commit -m "refactor: use useSessionListener hook in Swipe"
```

---

## Task 3: Add Session Listener & Reload to Import

**Files:**
- Modify: `frontend/src/screens/Import.tsx`

**Interfaces:**
- Consumes: `useSessionListener` from `../hooks`, `api` from `../api`
- Produces: Same Import component, now with session listener and reload button

**Steps:**

- [ ] **Step 1: Update Import.tsx imports**

Replace the import section of `frontend/src/screens/Import.tsx` (lines 1-4) with:

```typescript
import { useState } from 'react';
import { api } from '../api';
import type { UserName } from '../types';
import { useSessionListener } from '../hooks';
```

- [ ] **Step 2: Add state for reload indicator**

In the Import function body, after the existing state declarations (after line 9), add:

```typescript
  const [deckReloadPending, setDeckReloadPending] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
```

- [ ] **Step 3: Add session listener hook**

After the new state declarations, add:

```typescript
  // Listen for session changes from the other user; reload deck on change.
  useSessionListener(user, currentSessionId, (newSessionId) => {
    setCurrentSessionId(newSessionId);
  });
```

- [ ] **Step 4: Track session ID after import**

In the `importTitles` function, after `setResult(...)` succeeds, add a line to initialize the session:

Replace the try block (lines 13-14) with:

```typescript
      const importResult = await api.post('/import', { user, titles });
      setResult(importResult);
      // Initialize session tracking if not already set
      if (!currentSessionId) {
        const matches = await api.get('/matches');
        setCurrentSessionId(matches.sessionId);
      }
```

- [ ] **Step 5: Add reload button and pending state**

After the result display (around line 44), add a button for manual reload:

Replace the section from line 38 to 45:

```typescript
      {result && (
        <div className="text-sm text-neutral-400">
          <p>Importadas: {result.imported} ({result.minimal} sin datos de TMDB)</p>
          <button onClick={onDone} disabled={deckReloadPending} className="mt-3 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100 disabled:opacity-40">
            {deckReloadPending ? 'Recargando…' : 'Empezar a swipear'}
          </button>
          {deckReloadPending && <p className="mt-2 text-xs text-neutral-500">Actualizando mazo en el otro dispositivo…</p>}
        </div>
      )}
```

- [ ] **Step 6: Add manual reload button below import form**

After the import button (around line 37), add:

```typescript
      {!result && (
        <button
          onClick={async () => {
            setDeckReloadPending(true);
            try {
              const matches = await api.get('/matches');
              setCurrentSessionId(matches.sessionId);
            } finally {
              setDeckReloadPending(false);
            }
          }}
          disabled={loading || !titles.trim()}
          className="rounded-lg bg-neutral-800 px-6 py-3 font-medium disabled:opacity-40 text-sm"
        >
          {deckReloadPending ? 'Recargando…' : 'Recargar deck'}
        </button>
      )}
```

- [ ] **Step 7: Run a quick manual check**

Verify Import.tsx compiles without errors:

```bash
cd /Users/jo/Documents/TheCinematicUs && npx tsc --noEmit frontend/src/screens/Import.tsx 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
cd /Users/jo/Documents/TheCinematicUs && git add frontend/src/screens/Import.tsx && git commit -m "feat: add session listener and reload button to Import screen"
```

---

## Summary

This plan achieves the goal of fixing Import-Swipe desync by:

1. **Creating a reusable hook** (`useSessionListener`) that encapsulates Realtime session change listening
2. **Refactoring Swipe** to use the hook, removing duplicated logic
3. **Adding session awareness to Import**, so the screen listens to session changes and can reload the deck
4. **Providing manual reload** for cases where the user wants to refresh the deck without waiting for Realtime events

Each task is independently testable and produces a clear, focused change to the codebase.
</thinking>

Let me read a bit more context to refine the spec accurately.
<function_calls>
<invoke name="Read">
<parameter name="file_path">/Users/jo/Documents/TheCinematicUs/frontend/src/api.ts