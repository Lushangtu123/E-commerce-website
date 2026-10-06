'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FiUser } from 'react-icons/fi';
import { useAuthStore, type User, storedSessionId } from '@/store/useAuthStore';
import { userApi, type ProfileInput } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import ChangePassword from '@/components/ChangePassword';
import { requestFailure } from '@/lib/api-error';

type Draft = { username: string; phone: string; avatar_url: string };
type Loaded = { key: string; profile?: User; error?: string };
const valuesOf = (profile: User): Draft => ({ username: profile.username, phone: profile.phone ?? '', avatar_url: profile.avatar_url ?? '' });
const equal = (a: Draft, b: Draft) => a.username === b.username && a.phone === b.phone && a.avatar_url === b.avatar_url;

function validProfile(value: User, userId: number | undefined): boolean {
  return !!value && value.user_id === userId && typeof value.username === 'string' && typeof value.email === 'string' &&
    (value.phone == null || typeof value.phone === 'string') && (value.avatar_url == null || typeof value.avatar_url === 'string');
}

export default function ProfileSettingsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, sessionId, isAuthenticated, isHydrated } = useAuthStore();
  const sessionKey = JSON.stringify([sessionId, user?.user_id]);
  const currentKey = useRef(sessionKey);
  currentKey.current = sessionKey;
  const [result, setResult] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const loaded = useRef<Loaded | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; error?: string; success?: string; reload?: boolean } | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const mutation = useRef<object | null>(null);
  const passwordChanged = useRef(false);
  const profile = result?.key === sessionKey ? result.profile : undefined;
  const busy = saving === sessionKey;
  const dirty = !!profile && !!draft && !equal(draft, valuesOf(profile));
  const isCurrent = () => {
    const state = useAuthStore.getState();
    try {
      return mounted.current && currentKey.current === sessionKey && state.isHydrated && state.isAuthenticated &&
        state.sessionId === sessionId && state.user?.user_id === user?.user_id && storedSessionId() === sessionId &&
        JSON.parse(localStorage.getItem('user') || 'null')?.user_id === user?.user_id;
    } catch { return false; }
  };
  const replaceDraft = (value: Draft | null) => { draftRef.current = value; setDraft(value); };
  const accept = (next: User) => {
    const value = { key: sessionKey, profile: next };
    loaded.current = value;
    setResult(value);
    replaceDraft(valuesOf(next));
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current += 1; };
  }, []);

  const loadProfile = async () => {
    if (!isCurrent() || mutation.current) return;
    const request = ++revision.current;
    setResult(null); loaded.current = null; replaceDraft(null); setNotice(null);
    try {
      const data = await userApi.getProfile();
      if (!isCurrent() || request !== revision.current) return;
      if (!validProfile(data.user, user?.user_id)) {
        setResult({ key: sessionKey, error: '用户资料响应无效，请重新加载' }); return;
      }
      if (!useAuthStore.getState().updateUser(data.user, sessionId!)) {
        setResult({ key: sessionKey, error: '无法同步个人资料，请重新加载' }); return;
      }
      accept(data.user);
    } catch (error) {
      if (isCurrent() && request === revision.current) setResult({ key: sessionKey, error: requestFailure(error).response?.data?.error || '加载个人资料失败，请重试' });
    }
  };

  useEffect(() => {
    setResult(null); loaded.current = null; replaceDraft(null); setNotice(null); setSaving(null); mutation.current = null;
    if (!isHydrated) return;
    if (!isAuthenticated) { router.push(passwordChanged.current ? '/login?passwordChanged=1' : '/login'); return; }
    passwordChanged.current = false;
    loadProfile();
    return () => { revision.current += 1; };
  }, [isHydrated, isAuthenticated, sessionId, user?.user_id, router]);

  const handleChange = (name: keyof Draft, value: string) => {
    if (!isCurrent() || mutation.current || !draftRef.current) return;
    replaceDraft({ ...draftRef.current, [name]: value });
    setNotice(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const current = draftRef.current;
    const previous = loaded.current;
    if (!isCurrent() || mutation.current || !current || previous?.key !== sessionKey || !previous.profile || equal(current, valuesOf(previous.profile))) return;
    const payload: ProfileInput = { username: current.username.trim(), phone: current.phone.trim() || null, avatar_url: current.avatar_url.trim() || null };
    let error = '';
    if (!payload.username || payload.username.length > 50) error = '用户名必须为1至50个字符';
    else if (payload.phone && payload.phone.length > 20) error = '联系电话必须为不超过20个字符的字符串或空值';
    else if (payload.avatar_url) {
      try {
        const url = new URL(payload.avatar_url);
        if (payload.avatar_url.length > 255 || !/^https?:\/\/\S+$/i.test(payload.avatar_url) || !['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch { error = '头像地址必须为不超过255个字符的HTTP(S)网址或空值'; }
    }
    if (error) { setNotice({ key: sessionKey, error }); return; }
    const operation = {};
    const generation = revision.current;
    mutation.current = operation; setSaving(sessionKey); setNotice(null);
    const active = () => isCurrent() && generation === revision.current && mutation.current === operation;
    try {
      const data = await userApi.updateProfile(payload);
      if (!active()) return;
      if (!validProfile(data.user, user?.user_id)) {
        setNotice({ key: sessionKey, error: '用户资料响应无效，请重新加载', reload: true }); return;
      }
      if (!useAuthStore.getState().updateUser(data.user, sessionId!)) {
        setNotice({ key: sessionKey, error: '资料已保存，但本地同步失败，请重新加载', reload: true }); return;
      }
      accept(data.user);
      setNotice({ key: sessionKey, success: '资料已保存' });
    } catch (error) {
      if (active()) setNotice({ key: sessionKey, error: requestFailure(error).response?.data?.error || '保存个人资料失败，请重试' });
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        if (isCurrent() && generation === revision.current) setSaving(null);
      }
    }
  };

  if (!isHydrated || !isAuthenticated || !isCurrent() || result?.key !== sessionKey) return <div className="container-custom py-12 text-gray-600" role="status">{t('个人资料加载中...')}</div>;

  return (
    <div className="container-custom py-8 max-w-2xl">
      <Link href="/profile" className="text-primary-600 underline">{t('返回个人中心')}</Link>
      <div className="flex items-center gap-3 mt-6 mb-6">
        <div className="rounded-xl p-3 bg-primary-50 text-primary-600"><FiUser size={28} /></div>
        <div><h1 className="text-2xl font-bold text-gray-900">{t('编辑资料')}</h1><p className="mt-1 text-sm text-gray-600">{t('更新您的用户名和联系方式')}</p></div>
      </div>
      {result.error ? (
        <div className="card p-6" role="alert"><p className="text-red-600">{t(result.error)}</p><button onClick={loadProfile} className="btn btn-outline mt-4">{t('重新加载资料')}</button></div>
      ) : profile && draft && (
        <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-6">
          <label className="block" htmlFor="profile-username"><span className="block mb-2 font-medium">{t('用户名')}</span>
            <input id="profile-username" name="username" className="input" value={draft.username} maxLength={50} required autoComplete="nickname" disabled={busy} onChange={event => handleChange('username', event.target.value)} />
          </label>
          <label className="block" htmlFor="profile-email"><span className="block mb-2 font-medium">{t('邮箱')}</span>
            <input id="profile-email" name="email" className="input bg-gray-50 text-gray-600" value={profile.email} readOnly aria-describedby="profile-email-hint" />
            <span id="profile-email-hint" className="block mt-2 text-sm text-gray-500">{t('邮箱用于登录，在此页面不可修改')}</span>
          </label>
          <label className="block" htmlFor="profile-phone"><span className="block mb-2 font-medium">{t('联系电话')}</span>
            <input id="profile-phone" name="phone" className="input" value={draft.phone} maxLength={20} type="tel" autoComplete="tel" disabled={busy} onChange={event => handleChange('phone', event.target.value)} />
          </label>
          <label className="block" htmlFor="profile-avatar"><span className="block mb-2 font-medium">{t('头像地址')}</span>
            <input id="profile-avatar" name="avatar_url" className="input" value={draft.avatar_url} maxLength={255} type="url" placeholder="https://" disabled={busy} aria-describedby="profile-avatar-hint" onChange={event => handleChange('avatar_url', event.target.value)} />
            <span id="profile-avatar-hint" className="block mt-2 text-sm text-gray-500">{t('使用HTTP(S)图片地址；手机号和头像留空即可清除')}</span>
          </label>
          {notice?.key === sessionKey && notice.error && <div role="alert" className="text-red-600 text-sm"><p>{t(notice.error)}</p>{notice.reload && <button type="button" disabled={busy} onClick={loadProfile} className="underline mt-2">{t('重新加载资料')}</button>}</div>}
          {notice?.key === sessionKey && notice.success && <div role="status" className="text-green-700 text-sm">{t(notice.success)}</div>}
          <div className="flex flex-wrap gap-3 border-t pt-6">
            <button type="submit" disabled={busy || !dirty} className="btn btn-primary disabled:opacity-50">{t(busy ? '保存中...' : '保存修改')}</button>
            <button type="button" disabled={busy || !dirty} className="btn btn-outline disabled:opacity-50" onClick={() => {
              const current = loaded.current;
              if (!isCurrent() || mutation.current || current?.key !== sessionKey || !current.profile) return;
              replaceDraft(valuesOf(current.profile)); setNotice(null);
            }}>{t('撤销修改')}</button>
          </div>
        </form>
      )}
      <ChangePassword key={sessionKey} onPasswordChanged={() => { if (isCurrent()) passwordChanged.current = true; }} />
    </div>
  );
}
