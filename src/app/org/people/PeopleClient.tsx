"use client";

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2, Mail, UserPlus } from 'lucide-react';

interface Props {
  org: any;
  currentUserId: string;
  canManage: boolean;
  members: any[];
  pendingInvites: any[];
}

export default function PeopleClient({ org, currentUserId, canManage, members, pendingInvites }: Props) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [localMembers, setLocalMembers] = useState(members);
  const [localInvites, setLocalInvites] = useState(pendingInvites);

  const seatUsage = `${localMembers.length} / ${org.seatLimit === 999 ? '∞' : org.seatLimit}`;

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch('/api/org/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: org.id, email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not send invitation');
        return;
      }
      toast.success(`Invitation sent to ${inviteEmail}`);
      setLocalInvites(prev => [data, ...prev]);
      setInviteEmail('');
    } catch {
      toast.error('Network error');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Remove this member from the organization?')) return;
    const res = await fetch(`/api/org/members?orgId=${org.id}&userId=${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setLocalMembers(prev => prev.filter(m => m.userId !== userId));
      toast.success('Member removed');
    } else {
      const data = await res.json();
      toast.error(data.error || 'Could not remove');
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    const res = await fetch(`/api/org/invitations?id=${inviteId}`, { method: 'DELETE' });
    if (res.ok) {
      setLocalInvites(prev => prev.filter(i => i.id !== inviteId));
      toast.success('Invitation cancelled');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h2>People</h2>
        <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Seats: <strong>{seatUsage}</strong></span>
      </div>
      <p style={{ opacity: 0.6, marginBottom: '24px', fontSize: '0.88rem' }}>Manage members and pending invitations.</p>

      {canManage && (
        <div style={{ background: 'var(--surface-2)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <UserPlus size={16} />
            <strong style={{ fontSize: '0.92rem' }}>Invite member</strong>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '6px',
                background: 'var(--surface-1)', border: '1px solid var(--border-light)',
                color: 'var(--foreground)', outline: 'none', fontSize: '0.88rem',
              }}
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as any)}
              style={{
                padding: '8px 12px', borderRadius: '6px',
                background: 'var(--surface-1)', border: '1px solid var(--border-light)',
                color: 'var(--foreground)', fontSize: '0.88rem',
              }}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} className="btn btn-primary">
              {inviting ? 'Sending...' : 'Invite'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '8px', opacity: 0.85 }}>Members</h3>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {localMembers.map(m => (
            <div key={m.userId} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9rem' }}>{m.email}</div>
                <div style={{ fontSize: '0.74rem', opacity: 0.5, textTransform: 'capitalize' }}>{m.role}</div>
              </div>
              {canManage && m.userId !== currentUserId && m.role !== 'owner' && (
                <button
                  onClick={() => handleRemoveMember(m.userId)}
                  style={{ background: 'transparent', border: 'none', color: '#e06c75', cursor: 'pointer', padding: '6px' }}
                  title="Remove member"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {localInvites.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1rem', marginBottom: '8px', opacity: 0.85 }}>Pending invitations</h3>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {localInvites.map(inv => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
                <Mail size={14} style={{ opacity: 0.5, marginRight: '10px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem' }}>{inv.email}</div>
                  <div style={{ fontSize: '0.74rem', opacity: 0.5, textTransform: 'capitalize' }}>{inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                </div>
                {canManage && (
                  <button
                    onClick={() => handleCancelInvite(inv.id)}
                    style={{ background: 'transparent', border: 'none', color: '#e06c75', cursor: 'pointer', padding: '6px' }}
                    title="Cancel invitation"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
