#!/usr/bin/env ruby
# frozen_string_literal: true
# Diagnostic only: static analysis, not a privilege attestation.
require 'yaml'
require 'json'

module PEOSWorkflowExposure
  EVENTS = %w[pull_request pull_request_target workflow_run issue_comment workflow_call].freeze
  SAFE_ID = /\A[A-Za-z0-9_.-]{1,255}\z/
  SECRET = /\bsecrets\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)|\bsecrets\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/i
  module_function

  def strings(value)
    case value
    when Hash then value.flat_map { |k, v| strings(k) + strings(v) }
    when Array then value.flat_map { |v| strings(v) }
    when String then [value]
    else []
    end
  end

  def scan(content)
    root = YAML.safe_load(content, permitted_classes: [], permitted_symbols: [], aliases: false)
    raise ArgumentError unless root.is_a?(Hash) && root['jobs'].is_a?(Hash)
    # YAML 1.1 parses the unquoted GitHub "on" key as boolean true.
    trigger = root.fetch('on') { root.fetch(true) }
    events = case trigger
             when Hash then trigger.keys.map(&:to_s)
             when Array then trigger.map(&:to_s)
             when String then [trigger]
             else raise ArgumentError
             end
    events &= EVENTS
    return [] if events.empty?
    root['jobs'].filter_map do |id, job|
      raise ArgumentError unless id.is_a?(String) && SAFE_ID.match?(id) && job.is_a?(Hash)
      relevant = strings(root.reject { |k, _| k == 'jobs' }) + strings(job)
      names = relevant.flat_map { |s| s.scan(SECRET).map { |m| m.compact.first.upcase } }.uniq.sort
      explicit = names.reject { |n| n == 'GITHUB_TOKEN' }
      flags = []
      flags << 'SECRET_REFERENCE' unless explicit.empty?
      flags << 'DYNAMIC_SECRET_CONTEXT' if relevant.any? { |s| s.gsub(SECRET, '').match?(/\bsecrets\b/i) && s.include?('$' + '{{') }
      flags << 'INHERITED_SECRETS' if job['secrets'] == 'inherit'
      flags << 'REUSABLE_WORKFLOW_REVIEW' if job.key?('uses')
      env = job['environment']
      env = env['name'] if env.is_a?(Hash)
      if job.key?('environment')
        flags << 'ENVIRONMENT_REACHABLE_FROM_PR_EVENT'
        flags << 'DYNAMIC_OR_UNKNOWN_ENVIRONMENT' unless env.is_a?(String) && SAFE_ID.match?(env)
      end
      [root['permissions'], job['permissions']].each do |p|
        flags << 'OIDC_CAPABILITY_REVIEW' if p == 'write-all' || (p.is_a?(Hash) && p['id-token'] == 'write')
        flags << 'WRITE_PERMISSION_REVIEW' if p == 'write-all' || (p.is_a?(Hash) && p.any? { |k,v| k != 'id-token' && v == 'write' })
      end
      steps = job.fetch('steps', [])
      raise ArgumentError unless steps.is_a?(Array) && steps.all? { |s| s.is_a?(Hash) }
      steps.each do |step|
        next unless step['uses'].is_a?(String) && step['uses'].start_with?('actions/checkout@')
        flags << 'CHECKOUT_IN_PR_EVENT'
        config = step.fetch('with', {})
        raise ArgumentError unless config.is_a?(Hash)
        flags << 'CHECKOUT_PERSISTED_CREDENTIALS_REVIEW' unless [false, 'false'].include?(config['persist-credentials'])
      end
      next if flags.empty?
      {'job' => id, 'events' => events.sort, 'environment' => (env.is_a?(String) && SAFE_ID.match?(env) ? env : nil),
       'secret_names' => explicit, 'flags' => flags.uniq.sort}
    end
  rescue Psych::Exception, ArgumentError, KeyError, TypeError
    [{'job' => nil, 'flags' => ['WORKFLOW_PARSE_OR_SHAPE_UNVERIFIED']}]
  end

  def report(directory)
    paths = Dir.glob(File.join(directory, '*.{yml,yaml}')).sort
    raise ArgumentError if paths.empty?
    paths.flat_map do |path|
      raise ArgumentError unless File.file?(path) && !File.symlink?(path) && SAFE_ID.match?(File.basename(path))
      scan(File.read(path)).map { |f| f.merge('workflow' => File.basename(path)) }
    end
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    raise ArgumentError unless ARGV.length == 1 && %w[--report-only --enforce].include?(ARGV.first)
    findings = PEOSWorkflowExposure.report(File.expand_path('../workflows', __dir__))
    puts JSON.pretty_generate({'mode' => 'DIAGNOSTIC_NO_AUTHORIZATION', 'findings' => findings, 'wildcard_activation' => 'HOLD'})
    exit(ARGV.first == '--enforce' && !findings.empty? ? 2 : 0)
  rescue ArgumentError, SystemCallError
    warn 'BLOCKED_WORKFLOW_INVENTORY_UNVERIFIED'
    exit 2
  end
end
