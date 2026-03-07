"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Calendar,
  AlertCircle,
} from "lucide-react";

interface VoteRecord {
  proposalId: string;
  vote: "yes" | "no" | "abstain";
  timestamp: string;
  proposalTitle?: string;
  outcome?: "passed" | "failed";
}

interface VotingHistoryProps {
  votes: VoteRecord[];
  userAddress?: string;
  loading?: boolean;
}

type FilterOutcome = "all" | "passed" | "failed";

export function VotingHistory({
  votes,
  userAddress,
  loading,
}: VotingHistoryProps) {
  const [filterOutcome, setFilterOutcome] = useState<FilterOutcome>("all");
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: "",
    end: "",
  });

  const filteredVotes = useMemo(() => {
    return votes.filter((vote) => {
      // Filter by outcome
      if (filterOutcome !== "all" && vote.outcome !== filterOutcome) {
        return false;
      }

      // Filter by date range
      if (dateRange.start || dateRange.end) {
        const voteDate = new Date(vote.timestamp);
        if (dateRange.start) {
          const startDate = new Date(dateRange.start);
          if (voteDate < startDate) return false;
        }
        if (dateRange.end) {
          const endDate = new Date(dateRange.end);
          if (voteDate > endDate) return false;
        }
      }

      return true;
    });
  }, [votes, filterOutcome, dateRange]);

  const stats = useMemo(() => {
    return {
      totalVotes: votes.length,
      passed: votes.filter((v) => v.outcome === "passed").length,
      failed: votes.filter((v) => v.outcome === "failed").length,
      yesVotes: votes.filter((v) => v.vote === "yes").length,
      noVotes: votes.filter((v) => v.vote === "no").length,
    };
  }, [votes]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        Loading voting history...
      </div>
    );
  }

  if (!userAddress) {
    return (
      <div className="p-8 text-center bg-gray-50 rounded-lg border border-gray-200">
        <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
        <p className="text-gray-600 font-medium">Connect wallet to view voting history</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-gray-600">Total Votes</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{stats.totalVotes}</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-gray-600">Passed</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{stats.passed}</div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-gray-600">Failed</div>
            <div className="text-2xl font-bold text-red-600 mt-1">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-gray-600">Yes Votes</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.yesVotes}</div>
          </CardContent>
        </Card>
        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-gray-600">No Votes</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">{stats.noVotes}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Outcome</label>
              <Select
                value={filterOutcome}
                onValueChange={(val) => setFilterOutcome(val as FilterOutcome)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Outcomes</SelectItem>
                  <SelectItem value="passed">Passed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">From Date</label>
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, start: e.target.value }))
                }
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">To Date</label>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, end: e.target.value }))
                }
                className="mt-2"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Votes List */}
      {filteredVotes.length === 0 ? (
        <div className="p-8 text-center bg-gray-50 rounded-lg border border-gray-200">
          <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 font-medium">No voting history found</p>
          <p className="text-sm text-gray-500 mt-1">
            Your votes will appear here once you participate in governance
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVotes.map((vote, idx) => (
            <Card key={`${vote.proposalId}-${idx}`}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-medium text-gray-900">
                        {vote.proposalTitle || `Proposal ${vote.proposalId.slice(0, 8)}...`}
                      </h4>
                      {vote.outcome === "passed" ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Passed
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
                          <XCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600 mt-2">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatDate(vote.timestamp)}
                      </div>
                      <div className="flex items-center gap-2">
                        {vote.vote === "yes" ? (
                          <>
                            <ThumbsUp className="h-4 w-4 text-green-600" />
                            <span className="font-medium text-green-700">Voted YES</span>
                          </>
                        ) : vote.vote === "no" ? (
                          <>
                            <ThumbsDown className="h-4 w-4 text-red-600" />
                            <span className="font-medium text-red-700">Voted NO</span>
                          </>
                        ) : (
                          <>
                            <Badge variant="outline">Abstained</Badge>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
