#include "PolledStream.hpp"
#include "PolledStreamHandle.hpp"

using namespace dlf::datastream;

PolledStream::PolledStream(Encodable &src, String id, microseconds sample_interval, microseconds phase, const char* notes)
    : AbstractStream(src, id, notes), _sample_interval_us(sample_interval), _phase_us(phase)
{
}

stream_handle_t PolledStream::handle(microseconds tick_interval, dlf_stream_idx_t idx)
{
    dlf_tick_t sample_interval_ticks = 0, sample_phase_ticks = 0;

    // These will throw div/0 if a 0 sample interval (every tick) is given.
    if (_sample_interval_us != std::chrono::microseconds::zero())
    {
        sample_interval_ticks = max(_sample_interval_us / tick_interval, 1ll);
        sample_phase_ticks = _phase_us / tick_interval;
    }

    return std::unique_ptr<AbstractStreamHandle>(new PolledStreamHandle(
        this,
        idx,
        sample_interval_ticks,
        sample_phase_ticks));
}

dlf_stream_type_e PolledStream::type()
{
    return POLLED;
}
