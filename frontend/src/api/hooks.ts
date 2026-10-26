import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { needMeta, needOrder } from '../lib/meta'
import { api, ApiError } from './client'
import type {
  Category,
  CategoryCreateRequest,
  CategoryListResponse,
  CategoryPatchRequest,
  ConfirmLocationRequest,
  CreateReportResponse,
  DuplicatesResponse,
  GeocodeResponse,
  HealthResponse,
  MergeRequest,
  NeedCategory,
  OriginalResponse,
  PublicReportsResponse,
  PublicStats,
  Report,
  ReportListParams,
  ReportListResponse,
  ReviewerFields,
  ReviewerResponse,
  ReviewerStats,
  ReviewRequest,
  SimulatorSendRequest,
  SimulatorSendResponse,
  TranscriptRequest,
} from './types'

export const keys = {
  health: ['health'] as const,
  me: ['auth', 'me'] as const,
  reports: (params: ReportListParams) => ['reports', 'list', params] as const,
  report: (id: string) => ['reports', 'detail', id] as const,
  duplicates: (id: string) => ['reports', 'duplicates', id] as const,
  geocode: (q: string) => ['geocode', q] as const,
  publicReports: (need: NeedCategory[]) => ['public', 'reports', need] as const,
  publicStats: ['public', 'stats'] as const,
  stats: ['stats'] as const,
  categories: (includeInactive: boolean) => ['categories', includeInactive] as const,
}

const isExtracting = (s: string | null | undefined) => s === 'pending' || s === 'running'

// ---- Health & auth ------------------------------------------------------------------------

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: () => api.get<HealthResponse>('/api/health'),
    staleTime: 60_000,
  })
}

/** Demo mode drives the demo banner, the Simulator link and the demo checkbox (UI_UX_SPEC §4). */
export function useDemoMode(): boolean {
  return useHealth().data?.demo_mode === true
}

/** `data` is the reviewer when signed in, `null` when the API answers 401. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<ReviewerResponse>('/api/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (password: string) => api.post<ReviewerResponse>('/api/auth/login', { password }),
    onSuccess: (data) => qc.setQueryData(keys.me, data),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/api/auth/logout'),
    onSettled: () => {
      qc.setQueryData(keys.me, null)
      qc.removeQueries({ queryKey: ['reports'] })
      qc.removeQueries({ queryKey: keys.stats })
    },
  })
}

// ---- Submission & simulator ---------------------------------------------------------------

export function useSubmitReport() {
  return useMutation({
    mutationFn: (form: FormData) => api.post<CreateReportResponse>('/api/reports', form),
  })
}

/** Sends a recorded call (WAV) through the same path as a real helpline call. */
export function useSimulatorCall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: FormData) => api.post<SimulatorSendResponse>('/api/simulator/call', form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  })
}

export function useSimulatorSend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SimulatorSendRequest) =>
      api.post<SimulatorSendResponse>('/api/simulator/send', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  })
}

// ---- Reviewer: reports --------------------------------------------------------------------

export function useReports(params: ReportListParams) {
  return useQuery({
    queryKey: keys.reports(params),
    queryFn: () => api.get<ReportListResponse>('/api/reports', { ...params }),
    placeholderData: (prev) => prev,
    // §5.4: rows with pending extraction poll every 2 s; the whole list every 30 s.
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (r) => isExtracting(r.extraction_status) || isExtracting(r.transcript_status),
      )
        ? 2_000
        : 30_000,
  })
}

export function useReport(id: string, opts: { pollExtraction: boolean }) {
  return useQuery({
    queryKey: keys.report(id),
    queryFn: () => api.get<Report>(`/api/reports/${id}`),
    // §5.5: poll every 2 s while Gemma is reading; the caller stops after 120 s.
    refetchInterval: (query) =>
      opts.pollExtraction &&
      query.state.data &&
      (isExtracting(query.state.data.extraction.status) ||
        isExtracting(query.state.data.call?.transcript_status))
        ? 2_000
        : 30_000,
  })
}

/** Shared by every reviewer mutation that returns the updated Report. */
function useReportMutation<V>(id: string, fn: (vars: V) => Promise<Report>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (report) => {
      qc.setQueryData(keys.report(id), report)
      // Other reports change too (duplicate counts, merge targets), so refresh every report query.
      qc.invalidateQueries({
        queryKey: ['reports'],
        predicate: (q) => !(q.queryKey[1] === 'detail' && q.queryKey[2] === id),
      })
      qc.invalidateQueries({ queryKey: keys.stats })
      qc.invalidateQueries({ queryKey: ['public'] })
    },
  })
}

export function useOriginal(id: string) {
  return useMutation({
    mutationFn: () => api.get<OriginalResponse>(`/api/reports/${id}/original`),
  })
}

export function useRetryExtraction(id: string) {
  return useReportMutation(id, () => api.post<Report>(`/api/reports/${id}/retry-extraction`))
}

export function usePatchFields(id: string) {
  return useReportMutation(id, (fields: Partial<ReviewerFields>) =>
    api.patch<Report>(`/api/reports/${id}/fields`, fields),
  )
}

export function usePutTranscript(id: string) {
  return useReportMutation(id, (body: TranscriptRequest) =>
    api.put<Report>(`/api/reports/${id}/transcript`, body),
  )
}

export function useConfirmLocation(id: string) {
  return useReportMutation(id, (body: ConfirmLocationRequest) =>
    api.post<Report>(`/api/reports/${id}/location`, body),
  )
}

export function useMerge(id: string) {
  return useReportMutation(id, (body: MergeRequest) =>
    api.post<Report>(`/api/reports/${id}/merge`, body),
  )
}

export function useReview(id: string) {
  return useReportMutation(id, (body: ReviewRequest) =>
    api.post<Report>(`/api/reports/${id}/review`, body),
  )
}

export function useDuplicates(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.duplicates(id),
    queryFn: () => api.get<DuplicatesResponse>(`/api/reports/${id}/duplicates`),
    enabled,
  })
}

export function useGeocode(q: string) {
  const query = q.trim()
  return useQuery({
    queryKey: keys.geocode(query),
    queryFn: () => api.get<GeocodeResponse>('/api/geocode', { q: query }),
    enabled: query.length >= 2 && query.length <= 200,
    staleTime: Infinity,
    retry: false,
  })
}

// ---- Public & dashboard -------------------------------------------------------------------

export function usePublicReports(need: NeedCategory[]) {
  return useQuery({
    queryKey: keys.publicReports(need),
    queryFn: () => api.get<PublicReportsResponse>('/api/public/reports', { need }),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}

export function usePublicStats() {
  return useQuery({
    queryKey: keys.publicStats,
    queryFn: () => api.get<PublicStats>('/api/public/stats'),
    refetchInterval: 30_000,
  })
}

export function useStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: () => api.get<ReviewerStats>('/api/stats'),
    refetchInterval: 30_000,
  })
}

// ---- Help categories ----------------------------------------------------------------------

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: keys.categories(includeInactive),
    queryFn: () =>
      api.get<CategoryListResponse>('/api/categories', {
        include_inactive: includeInactive ? 'true' : undefined,
      }),
    staleTime: 60_000,
  })
}

/** Labels, icons and display order for need categories, including organizer-added ones. */
export function useNeeds() {
  const { data } = useCategories()
  const categories: Category[] | undefined = data?.items
  const meta = useCallback((key: NeedCategory) => needMeta(key, categories), [categories])
  return { categories: categories ?? [], meta, order: needOrder(categories) }
}

function useCategoryMutation<V>(fn: (vars: V) => Promise<Category>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })
}

export function useCreateCategory() {
  return useCategoryMutation((body: CategoryCreateRequest) =>
    api.post<Category>('/api/categories', body),
  )
}

export function usePatchCategory() {
  return useCategoryMutation(({ key, ...body }: CategoryPatchRequest & { key: string }) =>
    api.patch<Category>(`/api/categories/${key}`, body),
  )
}
