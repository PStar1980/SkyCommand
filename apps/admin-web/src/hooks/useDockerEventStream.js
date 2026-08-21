import { useEffect, useRef, useState } from 'react';
import infrastructureService from '../services/infrastructureService.js';

const MAX_VISIBLE_DOCKER_EVENTS = 25;
const RECONNECT_DELAYS_MS = [1000, 2500, 5000, 10000];

function useDockerEventStream() {
  const [events, setEvents] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
  const [sourceStatus, setSourceStatus] = useState('WAITING');
  const [sourceHostname, setSourceHostname] = useState('');
  const [sourceErrorCode, setSourceErrorCode] = useState('');
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(null);
  const [lastEventAt, setLastEventAt] = useState(null);
  const [error, setError] = useState('');
  const lastEventIdRef = useRef('');
  const seenEventIdsRef = useRef(new Set());

  useEffect(() => {
    let stopped = false;
    let controller = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;

    function scheduleReconnect(connect) {
      if (stopped) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    }

    async function connect() {
      if (stopped) return;

      controller = new AbortController();
      setConnectionStatus(reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING');

      try {
        await infrastructureService.streamDockerEvents({
          signal: controller.signal,
          lastEventId: lastEventIdRef.current,
          onOpen: () => {
            reconnectAttempt = 0;
            setConnectionStatus('CONNECTED');
            setError('');
          },
          onEvent: ({ event, id, data }) => {
            if (stopped || !data || typeof data !== 'object') return;

            if (event === 'stream-status') {
              setSourceStatus(data.status || 'WAITING');
              setSourceHostname(data.sourceHostname || '');
              setSourceErrorCode(data.sourceErrorCode || '');
              setLastHeartbeatAt(data.lastHeartbeatAt || null);
              return;
            }

            if (event !== 'docker-event') return;

            if (id) lastEventIdRef.current = id;
            const eventKey = data.eventId || id || `${data.occurredAt}:${data.containerId}:${data.action}`;
            if (seenEventIdsRef.current.has(eventKey)) return;

            seenEventIdsRef.current.add(eventKey);
            if (seenEventIdsRef.current.size > MAX_VISIBLE_DOCKER_EVENTS * 4) {
              const retainedKeys = [...seenEventIdsRef.current].slice(-MAX_VISIBLE_DOCKER_EVENTS * 2);
              seenEventIdsRef.current = new Set(retainedKeys);
            }

            setLastEventAt(data.receivedAt || data.occurredAt || new Date().toISOString());
            setEvents((current) => [data, ...current].slice(0, MAX_VISIBLE_DOCKER_EVENTS));
          },
        });

        if (!stopped) {
          setConnectionStatus('DISCONNECTED');
          scheduleReconnect(connect);
        }
      } catch (streamError) {
        if (stopped || streamError?.name === 'AbortError') return;
        setConnectionStatus('DISCONNECTED');
        setError(streamError?.message || 'Docker live event stream disconnected.');
        scheduleReconnect(connect);
      }
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      controller?.abort();
    };
  }, []);

  return {
    connectionStatus,
    error,
    events,
    lastEventAt,
    lastHeartbeatAt,
    sourceErrorCode,
    sourceHostname,
    sourceStatus,
  };
}

export default useDockerEventStream;
