import { useState, useEffect, useMemo } from 'react';
import { repository } from '../../data/repository';
import type { Appointment, Patient, ProgressRecord, UserActivity } from '../../types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import { formatCalendarDate, formatCurrency, formatTime, getAppointmentTypeLabel, getLocalDateISO } from '../../utils/format';
import { formatLastActivity, formatTimestamp } from '../../utils/activity';
import { isAppointmentPaid, needsPayment, paymentDateOf } from '../../utils/appointmentWorkflow';

const COLORS = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const CALENDAR_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const CALENDAR_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const APPOINTMENT_STATUS_META: Record<Appointment['status'], { label: string; eventClass: string; badgeClass: string; dotClass: string }> = {
  scheduled: { label: 'Programada', eventClass: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200', badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200', dotClass: 'bg-sky-400' },
  confirmed: { label: 'Confirmada', eventClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200', badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200', dotClass: 'bg-emerald-400' },
  completed: { label: 'Completada', eventClass: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200', badgeClass: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200', dotClass: 'bg-violet-400' },
  cancelled: { label: 'Cancelada', eventClass: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200', badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200', dotClass: 'bg-rose-400' },
  'no-show': { label: 'No asistió', eventClass: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200', badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200', dotClass: 'bg-amber-400' },
};

type TimeRange = 'week' | 'month' | 'year' | 'all' | 'custom';

function parseAmount(val: number | null | undefined): number {
  if (val == null) return 0;
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
}

function getRange(range: TimeRange, startDate: string, endDate: string) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (range === 'week') start.setDate(end.getDate() - 6);
  if (range === 'month') start.setMonth(end.getMonth() - 1);
  if (range === 'year') start.setFullYear(end.getFullYear() - 1);
  if (range === 'all') start.setTime(0);
  if (range === 'custom') {
    if (!startDate || !endDate) return null;
    const customStart = parseCalendarDate(startDate);
    const customEnd = parseCalendarDate(endDate);
    customEnd.setHours(23, 59, 59, 999);
    return { start: customStart, end: customEnd };
  }
  return { start, end };
}

export function UserMetrics({ therapistId, therapistName }: { therapistId: string; therapistName?: string }) {
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [progressRecords, setProgressRecords] = useState<ProgressRecord[]>([]);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [agendaMonth, setAgendaMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedAgendaDate, setSelectedAgendaDate] = useState(getLocalDateISO());

  useEffect(() => {
    let active = true;
    Promise.all([repository.fetchAppointmentsByTherapist(therapistId), repository.fetchPatientsByTherapist(therapistId), repository.fetchProgressRecordsByTherapist(therapistId)])
      .then(([appointmentData, patientData, progressData]) => { if (active) { setAppointments(appointmentData); setPatients(patientData); setProgressRecords(progressData); } })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [therapistId, refreshTick]);

  useEffect(() => {
    let active = true;
    repository.fetchUserActivities(therapistId)
      .then(data => { if (active) { setActivities(data); setActivityError(''); } })
      .catch((error: unknown) => {
        console.error('No se pudo obtener la actividad del terapeuta:', error);
        if (active) {
          setActivities([]);
          setActivityError('No se pudo cargar la actividad. Verifica que las reglas e índice de Firestore estén publicados.');
        }
      })
      .finally(() => { if (active) setActivitiesLoading(false); });
    return () => { active = false; };
  }, [therapistId, refreshTick]);

  const selectedRange = useMemo(() => getRange(timeRange, startDate, endDate), [timeRange, startDate, endDate]);
  const appointmentsInRange = useMemo(() => !selectedRange ? [] : appointments.filter(appointment => {
    const date = parseCalendarDate(appointment.date);
    return date >= selectedRange.start && date <= selectedRange.end;
  }), [appointments, selectedRange]);
  const filteredAppointments = useMemo(() => appointmentsInRange.filter(appointment => appointment.status !== 'cancelled' && appointment.status !== 'no-show'), [appointmentsInRange]);
  const filteredProgress = useMemo(() => !selectedRange ? [] : progressRecords.filter(record => {
    const date = parseCalendarDate(record.date);
    return date >= selectedRange.start && date <= selectedRange.end;
  }), [progressRecords, selectedRange]);
  const paidAppointmentsInRange = useMemo(() => !selectedRange ? [] : appointments
    .filter(appointment => {
      const paidAt = paymentDateOf(appointment);
      return isAppointmentPaid(appointment) && paidAt >= selectedRange.start && paidAt <= selectedRange.end;
    })
    .sort((a, b) => paymentDateOf(b).getTime() - paymentDateOf(a).getTime()), [appointments, selectedRange]);
  const appointmentsWithRecordedAmount = useMemo(() => filteredAppointments.filter(appointment => parseAmount(appointment.amount) > 0), [filteredAppointments]);
  const calendarAppointments = useMemo(() => {
    return appointments.slice().sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }, [appointments]);
  const calendarAppointmentsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    calendarAppointments.forEach(appointment => {
      const appointmentsForDay = map.get(appointment.date) || [];
      appointmentsForDay.push(appointment);
      map.set(appointment.date, appointmentsForDay);
    });
    return map;
  }, [calendarAppointments]);
  const agendaCalendar = useMemo(() => {
    const year = agendaMonth.getFullYear();
    const month = agendaMonth.getMonth();
    const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return {
      year,
      month,
      days: [
        ...Array.from({ length: firstDayOffset }, () => null as number | null),
        ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
      ],
    };
  }, [agendaMonth]);
  const selectedCalendarAppointments = useMemo(
    () => calendarAppointmentsByDate.get(selectedAgendaDate) || [],
    [calendarAppointmentsByDate, selectedAgendaDate],
  );
  const pendingSessionCount = useMemo(() => {
    const today = getLocalDateISO();
    return appointments.filter(appointment => appointment.date >= today && ['scheduled', 'confirmed'].includes(appointment.status)).length;
  }, [appointments]);

  const metrics = useMemo(() => {
    const completed = filteredAppointments.filter(a => a.status === 'completed');
    const totalSales = appointmentsWithRecordedAmount.reduce((sum, a) => sum + parseAmount(a.amount), 0);
    const totalAppointments = filteredAppointments.length;
    const uniquePatients = new Set(filteredAppointments.map(a => a.patientId)).size;
    const documentedSessions = completed.filter(a => a.sessionNote).length;
    const noShows = appointmentsInRange.filter(a => a.status === 'no-show').length;
    const attendedOrMissed = completed.length + noShows;
    const attendanceRate = attendedOrMissed ? Math.round((completed.length / attendedOrMissed) * 100) : null;
    const pendingSessions = pendingSessionCount;
    const averageTicket = appointmentsWithRecordedAmount.length ? totalSales / appointmentsWithRecordedAmount.length : 0;
    const notesWithPain = completed.filter(a => Number.isFinite(a.sessionNote?.painBefore) && Number.isFinite(a.sessionNote?.painAfter));
    const averagePainChange = notesWithPain.length
      ? Math.round((notesWithPain.reduce((sum, a) => sum + ((a.sessionNote?.painAfter ?? 0) - (a.sessionNote?.painBefore ?? 0)), 0) / notesWithPain.length) * 10) / 10
      : null;
    return { totalSales, totalAppointments, uniquePatients, completedSessions: completed.length, documentedSessions, attendanceRate, averagePainChange, noShows, pendingSessions, averageTicket };
  }, [filteredAppointments, appointmentsInRange, appointmentsWithRecordedAmount, pendingSessionCount]);

  const clinicalMetrics = useMemo(() => {
    const relevant = filteredProgress;
    const averageRecovery = relevant.length ? Math.round(relevant.reduce((sum, record) => sum + (record.mobilityScore + record.strengthScore + record.functionalScore) / 3, 0) / relevant.length) : 0;
    return { activePatients: patients.filter(patient => patient.status === 'active').length, progressEntries: relevant.length, averageRecovery };
  }, [patients, filteredProgress]);

  const amountBreakdown = useMemo(() => {
    const completedAppointments = filteredAppointments.filter(a => a.status === 'completed');
    const paidCompletedAppointments = completedAppointments.filter(isAppointmentPaid);
    const withoutAmount = completedAppointments.filter(needsPayment);
    const totalCharged = paidAppointmentsInRange.reduce((sum, a) => sum + parseAmount(a.amount), 0);
    return {
      completedCount: completedAppointments.length,
      paidCompletedCount: paidCompletedAppointments.length,
      withAmountCount: paidAppointmentsInRange.length,
      withoutAmountCount: withoutAmount.length,
      totalCharged,
      paidAppointments: paidAppointmentsInRange,
      appointmentsWithoutAmount: withoutAmount.map(a => ({ id: a.id, patientName: a.patientName, date: a.date, type: a.type })),
    };
  }, [filteredAppointments, paidAppointmentsInRange]);

  const salesByPeriod = useMemo(() => {
    const grouped: Record<string, number> = {};
    appointmentsWithRecordedAmount.forEach(a => {
      const date = parseCalendarDate(a.date);
      let key: string;
      switch (timeRange) {
        case 'week':
          key = date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
          break;
        case 'month':
          key = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
          break;
        case 'year':
          key = date.toLocaleDateString('es-MX', { month: 'short' });
          break;
        default:
          key = date.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
      }
      grouped[key] = (grouped[key] || 0) + parseAmount(a.amount);
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [appointmentsWithRecordedAmount, timeRange]);

  const appointmentsByPeriod = useMemo(() => {
    const grouped: Record<string, number> = {};
    filteredAppointments.forEach(a => {
      const date = parseCalendarDate(a.date);
      let key: string;
      switch (timeRange) {
        case 'week':
          key = date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
          break;
        case 'month':
          key = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
          break;
        case 'year':
          key = date.toLocaleDateString('es-MX', { month: 'short' });
          break;
        default:
          key = date.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
      }
      grouped[key] = (grouped[key] || 0) + 1;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [filteredAppointments, timeRange]);

  const patientGenderData = useMemo(() => {
    const male = patients.filter(patient => patient.gender === 'male').length;
    const female = patients.filter(patient => patient.gender === 'female').length;
    const other = patients.filter(patient => patient.gender === 'other').length;
    const total = male + female + other;
    if (total === 0) return [];
    return [
      { name: 'Masculino', value: male },
      { name: 'Femenino', value: female },
      { name: 'Otro', value: other },
    ].filter((d) => d.value > 0);
  }, [patients]);

  const totalPatientsUnique = useMemo(() => {
    return new Set(filteredAppointments.map(a => a.patientId)).size;
  }, [filteredAppointments]);

  const activitySummary = useMemo(() => {
    const activitiesInRange = !selectedRange ? [] : activities.filter(activity => {
      const timestamp = new Date(activity.timestamp);
      return timestamp >= selectedRange.start && timestamp <= selectedRange.end;
    });
    const clicks = activitiesInRange.filter(a => a.action === 'click');
    const pageViews = activitiesInRange.filter(a => a.action === 'page_view');
    const logins = activitiesInRange.filter(a => a.action === 'login');
    const lastActivity = activitiesInRange.length > 0 ? activitiesInRange[0].timestamp : null;
    const activeDays = new Set(activitiesInRange.map(a => new Date(a.timestamp).toLocaleDateString('en-CA'))).size;
    const sessions = new Set(logins.map(a => a.sessionId)).size;
    return { clicks: clicks.length, pageViews: pageViews.length, logins: logins.length, activeDays, lastActivity, totalSessions: sessions, recentActivities: activitiesInRange.slice(0, 10) };
  }, [activities, selectedRange]);

  const handleRefresh = () => {
    setLoading(true);
    setActivitiesLoading(true);
    setRefreshTick(t => t + 1);
  };

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">Cargando métricas...</div>
    );
  }

  return (
    <Card className="space-y-6 border-0 shadow-none">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div><h3 className="text-lg font-semibold text-gray-900">Métricas del terapeuta</h3>{therapistName && <p className="mt-1 text-sm text-slate-500">{therapistName}</p>}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="week">Última semana</option>
              <option value="month">Último mes</option>
              <option value="year">Último año</option>
              <option value="all">Todo</option>
              <option value="custom">Rango personalizado</option>
            </select>
            {timeRange === 'custom' && (
              <>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </>
            )}
            <Button variant="ghost" onClick={handleRefresh} className="px-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardBody>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl border border-primary/20">
            <p className="text-sm text-gray-500 font-medium">Ingresos registrados</p>
            <p className="text-2xl font-bold text-primary-dark mt-1">{formatCurrency(metrics.totalSales)}</p>
            <p className="mt-1 text-xs text-gray-500">Montos capturados en citas vigentes del período</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-secondary/10 to-secondary/5 rounded-xl border border-secondary/20">
            <p className="text-sm text-gray-500 font-medium">Sesiones realizadas</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.completedSessions}</p>
            <p className="mt-1 text-xs text-gray-500">{metrics.attendanceRate === null ? 'Sin sesiones cerradas' : `${metrics.attendanceRate}% de asistencia`}</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-accent/10 to-accent/5 rounded-xl border border-accent/20">
            <p className="text-sm text-gray-500 font-medium">Pacientes activos</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{clinicalMetrics.activePatients}</p>
            <p className="mt-1 text-xs text-gray-500">{totalPatientsUnique} atendidos en el período</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-clay/10 to-clay/5 rounded-xl border border-clay/20">
            <p className="text-sm text-gray-500 font-medium">Notas de sesión</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.documentedSessions}/{metrics.completedSessions}</p>
            <p className="mt-1 text-xs text-gray-500">{metrics.completedSessions ? Math.round((metrics.documentedSessions / metrics.completedSessions) * 100) : 0}% documentadas</p>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 to-sky-500/5 p-4 dark:border-sky-500/30 dark:from-sky-500/20 dark:to-sky-500/10">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-300">Agenda pendiente</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{metrics.pendingSessions}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Citas futuras · {metrics.noShows} inasistencias en el período</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-violet-500/10 to-violet-500/5 rounded-xl border border-violet-500/20">
            <p className="text-sm text-gray-500 font-medium">Ticket promedio</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(metrics.averageTicket)}</p>
            <p className="mt-1 text-xs text-gray-500">Por cita con monto</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs font-semibold text-slate-400">Registros de evolución</p><p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{clinicalMetrics.progressEntries}</p></div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs font-semibold text-slate-400">Recuperación promedio</p><p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{clinicalMetrics.averageRecovery}%</p></div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs font-semibold text-slate-400">Cambio de dolor por sesión</p><p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{metrics.averagePainChange === null ? 'Sin datos' : `${metrics.averagePainChange > 0 ? '+' : ''}${metrics.averagePainChange}`}</p></div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs font-semibold text-slate-400">Pacientes atendidos</p><p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{metrics.uniquePatients}</p><p className="mt-1 text-[10px] text-slate-400">En el período</p></div>
        </div>

        <div className="mb-6 overflow-hidden rounded-xl border border-sky-200 bg-white dark:border-sky-900/70 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3 dark:border-sky-900/70 dark:bg-sky-950/40">
            <div>
              <h4 className="text-sm font-semibold text-sky-900 dark:text-sky-100">Agenda de citas</h4>
              <p className="mt-0.5 text-xs text-sky-700 dark:text-sky-300">Todas las citas registradas para este terapeuta.</p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-sky-700 shadow-sm dark:bg-slate-800 dark:text-sky-200">{calendarAppointments.length} registradas</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(220px,0.85fr)]">
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Mes anterior"
                  onClick={() => setAgendaMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-200"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m15 19-7-7 7-7" /></svg>
                </button>
                <p className="text-sm font-bold text-slate-800 dark:text-white">{CALENDAR_MONTHS[agendaCalendar.month]} {agendaCalendar.year}</p>
                <button
                  type="button"
                  aria-label="Mes siguiente"
                  onClick={() => setAgendaMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-200"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 5 7 7-7 7" /></svg>
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {CALENDAR_DAYS.map(day => <div key={day} className="py-1 text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500">{day}</div>)}
                {agendaCalendar.days.map((day, index) => {
                  if (day === null) return <div key={`agenda-empty-${index}`} className="min-h-16 rounded-lg" />;
                  const iso = `${agendaCalendar.year}-${String(agendaCalendar.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayAppointments = calendarAppointmentsByDate.get(iso) || [];
                  const isSelected = iso === selectedAgendaDate;
                  const isToday = iso === getLocalDateISO();
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSelectedAgendaDate(iso)}
                      className={`min-h-16 rounded-lg border p-1 text-left transition-colors ${
                        isSelected ? 'border-primary bg-primary-light ring-1 ring-primary/20 dark:border-sky-400 dark:bg-sky-500/20' : isToday ? 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/50' : 'border-slate-100 hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:hover:border-sky-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className={`block text-xs font-semibold ${isToday ? 'text-primary dark:text-sky-300' : 'text-slate-600 dark:text-slate-300'}`}>{day}</span>
                      {dayAppointments.slice(0, 2).map(appointment => (
                        <span key={appointment.id} className={`mt-1 block truncate rounded px-1 py-0.5 text-[9px] font-medium ${APPOINTMENT_STATUS_META[appointment.status].eventClass}`} title={`${appointment.startTime} · ${appointment.patientName}`}>
                          {appointment.startTime} {appointment.patientName.split(' ')[0]}
                        </span>
                      ))}
                      {dayAppointments.length > 2 && <span className="block px-1 text-[9px] font-semibold text-slate-400 dark:text-slate-500">+{dayAppointments.length - 2}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                {Object.entries(APPOINTMENT_STATUS_META).map(([status, meta]) => <span key={status} className="flex items-center gap-1"><i className={`h-2 w-2 rounded-full ${meta.dotClass}`} />{meta.label}</span>)}
              </div>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70 lg:border-l lg:border-t-0">
              <p className="text-sm font-semibold capitalize text-slate-800 dark:text-white">{formatCalendarDate(selectedAgendaDate, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedCalendarAppointments.length} {selectedCalendarAppointments.length === 1 ? 'cita' : 'citas'}</p>
              {selectedCalendarAppointments.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">No hay citas registradas para este día.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {selectedCalendarAppointments.map(appointment => {
                    const status = APPOINTMENT_STATUS_META[appointment.status];
                    return (
                      <div key={appointment.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-slate-800 dark:text-white">{formatTime(appointment.startTime)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.badgeClass}`}>{status.label}</span></div>
                        <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">{appointment.patientName}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{getAppointmentTypeLabel(appointment.type)} · hasta {formatTime(appointment.endTime)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 rounded-xl border border-emerald-500/20">
            <p className="text-sm text-gray-500 font-medium">Clicks registrados</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{activitySummary.clicks}</p>
            <p className="mt-1 text-xs text-gray-500">Interacciones en el sistema</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 rounded-xl border border-cyan-500/20">
            <p className="text-sm text-gray-500 font-medium">Páginas visitadas</p>
            <p className="text-2xl font-bold text-cyan-700 mt-1">{activitySummary.pageViews}</p>
            <p className="mt-1 text-xs text-gray-500">Navegaciones registradas</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 rounded-xl border border-amber-500/20">
            <p className="text-sm text-gray-500 font-medium">Última actividad</p>
            <p className="text-lg font-bold text-amber-700 mt-1">{activitySummary.lastActivity ? formatLastActivity(activitySummary.lastActivity) : 'Sin actividad'}</p>
            <p className="mt-1 text-xs text-gray-500">{activitySummary.activeDays} días de uso en este período</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-rose-500/10 to-rose-500/5 rounded-xl border border-rose-500/20">
            <p className="text-sm text-gray-500 font-medium">Sesiones iniciadas</p>
            <p className="text-2xl font-bold text-rose-700 mt-1">{activitySummary.totalSessions}</p>
            <p className="mt-1 text-xs text-gray-500">{activitySummary.logins} accesos registrados</p>
          </div>
        </div>

        {activitiesLoading ? (
          <div className="text-center py-6 text-sm text-gray-500">Cargando actividad...</div>
        ) : activityError ? (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {activityError}
          </div>
        ) : activitySummary.recentActivities.length > 0 ? (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Últimas acciones</h4>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Usuario</th>
                      <th className="text-left px-4 py-3 font-medium">Acción</th>
                      <th className="text-left px-4 py-3 font-medium">Detalle</th>
                      <th className="text-left px-4 py-3 font-medium">Página</th>
                      <th className="text-left px-4 py-3 font-medium">Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activitySummary.recentActivities.map(activity => (
                      <tr key={activity.id}>
                        <td className="px-4 py-3 font-medium text-gray-900">{activity.userName}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${activity.action === 'click' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {activity.action === 'click' ? 'Click' : activity.action === 'login' ? 'Inicio de sesión' : activity.action === 'page_view' ? 'Navegación' : activity.action === 'app_active' ? 'Aplicación activa' : 'En segundo plano'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{activity.details}</td>
                        <td className="px-4 py-3 text-gray-500">{activity.page || '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{formatTimestamp(activity.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 text-sm">
            No hay actividad registrada para este terapeuta.
          </div>
        )}

        {filteredAppointments.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Resumen de montos cobrados</h4>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 rounded-xl border border-emerald-500/20">
                <p className="text-sm text-gray-500 font-medium">Total cobrado</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(amountBreakdown.totalCharged)}</p>
                <p className="mt-1 text-xs text-gray-500">{amountBreakdown.withAmountCount} sesiones cobradas</p>
              </div>
              <div className="p-4 bg-gradient-to-br from-red-500/10 to-red-500/5 rounded-xl border border-red-500/20">
                <p className="text-sm text-gray-500 font-medium">Sin monto registrado</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{amountBreakdown.withoutAmountCount}</p>
                <p className="mt-1 text-xs text-gray-500">Sesiones cerradas sin cobro</p>
              </div>
              <div className="p-4 bg-gradient-to-br from-sky-500/10 to-sky-500/5 rounded-xl border border-sky-500/20">
                <p className="text-sm text-gray-500 font-medium">Ticket promedio</p>
                <p className="text-2xl font-bold text-sky-700 mt-1">{amountBreakdown.withAmountCount ? formatCurrency(amountBreakdown.totalCharged / amountBreakdown.withAmountCount) : '$0'}</p>
                <p className="mt-1 text-xs text-gray-500">Por cita con monto</p>
              </div>
              <div className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 rounded-xl border border-amber-500/20">
                <p className="text-sm text-gray-500 font-medium">% Cobrado</p>
                <p className="text-2xl font-bold text-amber-700 mt-1">{amountBreakdown.completedCount ? Math.round((amountBreakdown.paidCompletedCount / amountBreakdown.completedCount) * 100) : 0}%</p>
                <p className="mt-1 text-xs text-gray-500">De sesiones completadas</p>
              </div>
            </div>
            {amountBreakdown.paidAppointments.length > 0 && (
              <div className="mb-4 overflow-hidden rounded-xl border border-emerald-200 bg-white">
                <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3"><p className="text-sm font-semibold text-emerald-800">Pagos contabilizados ({amountBreakdown.paidAppointments.length})</p></div>
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 text-left font-medium">Paciente</th><th className="px-4 py-3 text-left font-medium">Fecha de pago</th><th className="px-4 py-3 text-left font-medium">Método</th><th className="px-4 py-3 text-right font-medium">Monto</th></tr></thead><tbody className="divide-y divide-slate-100">{amountBreakdown.paidAppointments.slice(0, 20).map(appointment => <tr key={appointment.id}><td className="px-4 py-3 font-medium text-slate-900">{appointment.patientName}</td><td className="px-4 py-3 text-slate-500">{paymentDateOf(appointment).toLocaleDateString('es-MX')}</td><td className="px-4 py-3 text-slate-500">{appointment.paymentMethod === 'cash' ? 'Efectivo' : appointment.paymentMethod === 'card' ? 'Tarjeta' : appointment.paymentMethod === 'transfer' ? 'Transferencia' : 'Sin especificar'}</td><td className="px-4 py-3 text-right font-bold text-emerald-700">{formatCurrency(parseAmount(appointment.amount))}</td></tr>)}</tbody></table></div>
              </div>
            )}
            {amountBreakdown.appointmentsWithoutAmount.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-700">Sesiones con cobro pendiente ({amountBreakdown.appointmentsWithoutAmount.length})</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">Paciente</th>
                        <th className="text-left px-4 py-3 font-medium">Fecha</th>
                        <th className="text-left px-4 py-3 font-medium">Tipo</th>
                        <th className="text-right px-4 py-3 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {amountBreakdown.appointmentsWithoutAmount.slice(0, 10).map(a => (
                        <tr key={a.id}>
                          <td className="px-4 py-3 font-medium text-gray-900">{a.patientName}</td>
                          <td className="px-4 py-3 text-gray-500">{formatCalendarDate(a.date, {})}</td>
                          <td className="px-4 py-3 text-gray-500 capitalize">{a.type}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">Pendiente de cobro</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {filteredAppointments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {timeRange === 'custom' && !selectedRange ? 'Selecciona fecha inicial y final para ver el análisis.' : 'No hay citas vigentes en el período seleccionado.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Ventas por período</h4>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={salesByPeriod}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(value: number) => [`$${value}`, 'Ventas']} contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                    <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorSales)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Citas por período</h4>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={appointmentsByPeriod}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                    <Bar dataKey="value" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {patientGenderData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Distribución por género</h4>
                <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={patientGenderData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}>
                        {patientGenderData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
