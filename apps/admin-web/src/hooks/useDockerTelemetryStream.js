import { useEffect, useMemo, useRef, useState } from 'react';
import infrastructureService from '../services/infrastructureService.js';

const MAX_VISIBLE_DOCKER_TELEMETRY_SAMPLES = 60;
const RECONNECT_DELAYS_MS = [1000, 2500, 5000, 10000];

function useDockerTelemetryStream() {
  const [samples, setSamples] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
  const [sourceStatus, setSourceStatus] = useState('WAITING');
  const [sourceHostname, setSourceHostname] = useState('');
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(null);
  const [lastSampleAt, setLastSampleAt] = useState(null);
  const [error, setError] = useState('');
  const lastEventIdRef = useRef('');
  const seenSampleIdsRef = useRef(new Set());

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
        await infrastructureService.streamDockerTelemetry({
          signal: controller.signal,
          lastEventId: lastEventIdRef.current,
          onOpen: () => {
            reconnectAttempt = 0;
            setConnectionStatus('CONNECTED');
            setError('');
          },
          onEvent: ({ event, id, data }) => {
            if (stopped || !data || typeof data !== 'object') return;

            if (event === 'telemetry-status') {
              setSourceStatus(data.status || 'WAITING');
              setSourceHostname(data.sourceHostname || '');
              setLastHeartbeatAt(data.lastHeartbeatAt || null);
              setLastSampleAt(data.lastSampleAt || null);
              return;
            }

            if (event !== 'docker-telemetry') return;
            if (id) lastEventIdRef.current = id;

            const sampleKey = data.sampleId || id || `${data.capturedAt}:${data.sequence}`;
            if (seenSampleIdsRef.current.has(sampleKey)) return;
            seenSampleIdsRef.current.add(sampleKey);
            if (seenSampleIdsRef.current.size > MAX_VISIBLE_DOCKER_TELEMETRY_SAMPLES * 4) {
              const retained = [...seenSampleIdsRef.current].slice(
                -MAX_VISIBLE_DOCKER_TELEMETRY_SAMPLES * 2,
              );
              seenSampleIdsRef.current = new Set(retained);
            }

            setLastSampleAt(data.receivedAt || data.capturedAt || new Date().toISOString());
            setSamples((current) => {
              const next = [...current, data]
                .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0))
                .slice(-MAX_VISIBLE_DOCKER_TELEMETRY_SAMPLES);
              return next;
            });
          },
        });

        if (!stopped) {
          setConnectionStatus('DISCONNECTED');
          scheduleReconnect(connect);
        }
      } catch (streamError) {
        if (stopped || streamError?.name === 'AbortError') return;
        setConnectionStatus('DISCONNECTED');
        setError(streamError?.message || 'Docker telemetry stream disconnected.');
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

  const latestSample = samples[samples.length - 1] || null;
  const sampleIntervalMs = useMemo(
    () => Number(latestSample?.sampleIntervalMs || 0),
    [latestSample?.sampleIntervalMs],
  );

  return {
    connectionStatus,
    error,
    lastHeartbeatAt,
    lastSampleAt,
    latestSample,
    sampleIntervalMs,
    samples,
    sourceHostname,
    sourceStatus,
  };
}

export default useDockerTelemetryStream;
