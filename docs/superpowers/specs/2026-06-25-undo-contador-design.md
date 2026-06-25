# Undo de swipe + contador de cards — Diseño

> Spec para el Milestone 6 (UX chico, §8 de la propuesta). Permite deshacer el
> último swipe y muestra cuántas películas quedan en el mazo.

## 1. Objetivo

Dos mejoras de UX mobile estándar:
- **Contador:** ver cuántas cards quedan ("12 por ver"). Cambia la psicología del
  swipe.
- **Undo (un nivel):** un toque mal y la peli se pierde hasta la próxima noche;
  deshacer el último swipe la trae de vuelta.

Alcance acordado:
- **Undo single-level**: solo el último swipe. Volver a swipear pisa el undo
  anterior (estándar mobile).
- El undo **borra el swipe** (la peli vuelve al pending) y, si ese swipe sostenía
  un match, **borra el match** (no dejar match fantasma por un like accidental).
- **No** se revierte `user_movie_state` (es solo pista de orden; el re-insert
  local trae la card al instante).
- El contador de **matches** del header puede quedar 1 alto tras deshacer un like
  que matcheó, hasta el próximo fetch de `/matches`. Edge aceptado.

## 2. Backend

### 2.1 `undoSwipe(sessionId, userId, movieId)` (en `match.ts`)
Borra el swipe y reconcilia el match a la inversa: si la peli ya no tiene 2
likers distintos en la sesión, borra el match. Funciona uniforme para pass y
like (si era pass, la peli no era un liker → el borrado del match es no-op).

```ts
export async function undoSwipe(
  sessionId: string, userId: string, movieId: string,
): Promise<void> {
  await supabase.from('swipes').delete()
    .eq('session_id', sessionId).eq('user_id', userId).eq('movie_id', movieId);

  // ¿Sigue siendo match? Hacen falta 2 usuarias distintas que la likearon.
  const { data: likers } = await supabase.from('swipes').select('user_id')
    .eq('session_id', sessionId).eq('movie_id', movieId).eq('liked', true);
  const distinct = new Set((likers ?? []).map((l: { user_id: string }) => l.user_id));
  if (distinct.size < 2) {
    await supabase.from('matches').delete()
      .eq('session_id', sessionId).eq('movie_id', movieId);
  }
}
```

### 2.2 `POST /swipe/undo` (en `index.ts`)
```ts
app.post('/swipe/undo', async (req, res) => {
  try {
    const { user, movieId } = req.body as { user: string; movieId: string };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    await undoSwipe(sessionId, userId, movieId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

No toca `user_movie_state` (decisión de alcance).

## 3. Frontend (`Swipe.tsx`)

### 3.1 Contador
`deck.length` ya es las cards que quedan (top + resto; se achica al swipear).
Mostrar un texto chico arriba del mazo (entre `FilterBar` y el área de la card):
```tsx
{deckLoaded && deck.length > 0 && (
  <div className="text-center text-xs text-neutral-500 pb-1">
    {deck.length} {deck.length === 1 ? 'peli' : 'pelis'} por ver
  </div>
)}
```

### 3.2 Undo
- Estado nuevo: `const [lastSwiped, setLastSwiped] = useState<Movie | null>(null);`
- En `swipe(liked)`, tras `setDeck((d) => d.slice(1))`, guardar
  `setLastSwiped(movie);`.
- Handler:
```tsx
async function undo() {
  if (!lastSwiped) return;
  const movie = lastSwiped;
  setLastSwiped(null);
  setDeck((d) => [movie, ...d]);
  x.set(0);
  await api.post('/swipe/undo', { user, movieId: movie.id });
}
```
- Botón **↩ Deshacer**: visible cuando hay `lastSwiped` y no se está reiniciando.
  Se ubica arriba de los botones de swipe, y **se renderiza aunque el mazo esté
  vacío** (podés deshacer el último swipe que vació el mazo):
```tsx
{lastSwiped && !resetting && (
  <div className="flex justify-center pb-2">
    <button onClick={undo} className="text-sm text-neutral-400 underline">↩ Deshacer</button>
  </div>
)}
```
- Limpiar `lastSwiped` en `softReset` (nueva sesión/reset) con
  `setLastSwiped(null);`.

(Single-level: cada swipe pisa `lastSwiped`. No hay pila.)

## 4. Testing

**Backend (vitest):** `match.undo.test.ts` (archivo nuevo, mock propio):
- `undoSwipe` borra el swipe de (sesión, usuaria, peli) con los tres filtros.
- Si quedan <2 likers distintos → borra el match.
- Si quedan ≥2 likers distintos → **no** borra el match.
- `POST /swipe/undo` (endpoint) sin tests unitarios; build + manual.

**Frontend:** sin runner; `tsc -b` + build + prueba manual (swipe, deshacer, ver
la card volver; contador baja/sube).

## 5. Fuera de alcance
- Multi-level undo / pila de undos.
- Revertir `user_movie_state` en el undo.
- Decrementar el contador de matches en vivo al deshacer un like que matcheó.

## 6. Resumen de archivos tocados
- `backend/src/match.ts` — `undoSwipe`.
- `backend/src/match.undo.test.ts` (nuevo).
- `backend/src/index.ts` — `POST /swipe/undo`.
- `frontend/src/screens/Swipe.tsx` — contador + `lastSwiped` + botón/handler de undo.
