"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { AlertCircle, TrendingUp } from "lucide-react";

interface PolicyAnalyticsProps {
  poolId: string;
}

// Mock data generators
const generateAprHistory = () => {
  const data = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  for (let i = 0; i < 90; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    data.push({
      date: date.toISOString().split("T")[0],
      tier1: 0,
      tier2: 5.8 + Math.random() * 0.4 - 0.2,
      tier3: 3.8 + Math.random() * 0.4 - 0.2,
    });
  }
  return data;
};

const generateUtilizationHistory = () => {
  const data = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  for (let i = 0; i < 90; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const baseUtilization = 60 + Math.sin(i / 10) * 20;
    data.push({
      date: date.toISOString().split("T")[0],
      utilization: Math.max(30, Math.min(90, baseUtilization + Math.random() * 10 - 5)),
      loans: 400000 + Math.random() * 200000 - 100000,
    });
  }
  return data;
};

const generateVotingParticipation = () => {
  return [
    { proposal: "Proposal 1", participation: 68 },
    { proposal: "Proposal 2", participation: 72 },
    { proposal: "Proposal 3", participation: 55 },
    { proposal: "Proposal 4", participation: 81 },
    { proposal: "Proposal 5", participation: 63 },
    { proposal: "Proposal 6", participation: 76 },
  ];
};

export function PolicyAnalytics({ poolId }: PolicyAnalyticsProps) {
  const [aprData, setAprData] = useState<any[]>([]);
  const [utilizationData, setUtilizationData] = useState<any[]>([]);
  const [participationData, setParticipationData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setAprData(generateAprHistory());
    setUtilizationData(generateUtilizationHistory());
    setParticipationData(generateVotingParticipation());
    setLoading(false);
  }, [poolId]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-xs">
              {entry.name}: {entry.value.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        Loading analytics...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* APR History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            APR History (90 Days)
          </CardTitle>
          <CardDescription>
            Historical lending rates by reputation tier
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={aprData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  interval={Math.floor(aprData.length / 6)}
                />
                <YAxis
                  label={{ value: "APR (%)", angle: -90, position: "insideLeft" }}
                  domain={[0, 8]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="tier2"
                  stroke="#3b82f6"
                  name="Tier 2"
                  isAnimationActive={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="tier3"
                  stroke="#10b981"
                  name="Tier 3"
                  isAnimationActive={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Pool Utilization */}
      <Card>
        <CardHeader>
          <CardTitle>Pool Utilization (90 Days)</CardTitle>
          <CardDescription>
            Percentage of vault capital currently lent out
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={utilizationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  interval={Math.floor(utilizationData.length / 6)}
                />
                <YAxis
                  label={{ value: "Utilization (%)", angle: -90, position: "insideLeft" }}
                  domain={[0, 100]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="utilization"
                  stroke="#8b5cf6"
                  fill="#c4b5fd"
                  name="Utilization %"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Voting Participation */}
      <Card>
        <CardHeader>
          <CardTitle>Voting Participation Rate</CardTitle>
          <CardDescription>
            Percentage of vault holders who participated in recent proposals
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={participationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="proposal" tick={{ fontSize: 12 }} />
                <YAxis
                  label={{ value: "Participation (%)", angle: -90, position: "insideLeft" }}
                  domain={[0, 100]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar
                  dataKey="participation"
                  fill="#06b6d4"
                  name="Participation %"
                  radius={[8, 8, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-600">Average APR (Tier 2)</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">5.8%</div>
            <p className="text-xs text-gray-500 mt-2">Over last 90 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-600">Average Utilization</div>
            <div className="text-3xl font-bold text-purple-600 mt-2">62%</div>
            <p className="text-xs text-gray-500 mt-2">Capital deployed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-600">Avg Participation</div>
            <div className="text-3xl font-bold text-cyan-600 mt-2">69%</div>
            <p className="text-xs text-gray-500 mt-2">Voter engagement</p>
          </CardContent>
        </Card>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-blue-900">Analytics Dashboard</p>
          <p className="text-blue-700 mt-1">
            Monitor lending rates, pool utilization, and governance participation trends to understand vault performance over time.
          </p>
        </div>
      </div>
    </div>
  );
}
