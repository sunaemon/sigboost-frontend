$(document).ready(function() {
    const url = window.location.href;

    if (/^https*:\/\/[^\/]*\/jobs\/$/.test(url)) {
        // just ignore it
    } else if (/^https*:\/\/[^\/]*\/jobs\/new\/*$/.test(url)) {
        const update = function() {
            $('#top').empty();
            const files = $('#max_patches').prop('files');
            for (let i = 0; i < files.length; i++) {
                $('#top').append($('<option>').val(files[i].name).text(files[i].name));
            }
        };
        update();
        $('#max_patches').change(update);
    } else if (/^https*:\/\/[^\/]*\/jobs\/(.*)$/.test(url)) {
        const m = url.match(/^https*:\/\/[^\/]*\/jobs\/(.*)$/);
        let last_line = 0;
        let state = null;
        let prev_done = true;

        function update_log()
        {

            $.get({
                url: `/jobs/data/${m[1]}`,
            }).then(data => {
                data.logs.slice(last_line).forEach(log => {
                    const row = $('<tr>').append(`<td style="white-space: nowrap;text-align: right">${Date.parse(log.timestamp) - Date.parse(data.job.start)} ms</td><td>${log.data}`);
                    $('#logs > tbody').append(row);
                });
                last_line = data.logs.length;

                if (data.job.outputfile_can_be_downloaded) {
                   $('#download_link').show();
                }

                if (!prev_done && data.job.done) {
                    if (data.job.outputfile_can_be_downloaded) {

                        const jobDoneNotification = new Notify('Build Success!', {
                           body: 'Please download the output file.',
                           tag: 'jobDoneNotification'
                        });
                        jobDoneNotification.show();
                    } else {
                        const jobDoneNotification = new Notify('Build Failed!', {
                           body: 'Pleese see the log.',
                           tag: 'jobDoneNotification'
                        });
                        jobDoneNotification.show();
                    }
                }

                prev_done = data.job.done;

                if (!data.job.done) {
                    setTimeout(update_log, 1000);
                }
            });
        }
        update_log();

        if (Notify.needsPermission && Notify.isSupported()) {
            Notify.requestPermission()
        }
    }

    // カード幅変更用
    if($('.jobs_show').length || $('.jobs_index').length) {
        $('.main_card').css({
            'width': '1000px',
            'left': 'calc(50% - 1000px / 2)'
        });
    }
});
